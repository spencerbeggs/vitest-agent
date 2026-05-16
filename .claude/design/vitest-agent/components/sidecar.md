---
status: current
module: vitest-agent-reporter
category: performance
created: 2026-05-15
updated: 2026-05-16
last-synced: 2026-05-16
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-flows.md
  - ./cli.md
  - ./plugin-claude.md
dependencies: []
---

# Sidecar package (`vitest-agent-sidecar`)

The seventh publishable workspace. Sole responsibility: ship a fast-path native binary for the `inject-env` operation that fires on the per-Bash-call hot path of the PreToolUse Bash hook. It exists to eliminate Node cold-start latency from that hook without changing the hook's observable behavior.

**npm name:** `vitest-agent-sidecar`
**Bin:** `vitest-agent-sidecar`
**Location:** `packages/sidecar/`
**Internal dependencies:** `vitest-agent-cli`, `vitest-agent-sdk`

The package landed in workstream T9.2. For the latency problem it solves and the layered approach, see [../decisions.md](../decisions.md) Decision 42 and the implementation spec at `docs/superpowers/specs/2.0-sidecar-perf.md`.

## Why it exists

Before T9.2, every Bash tool call from a Claude Code agent shelled out to the JS CLI (`vitest-agent agent inject-env`) inside the PreToolUse Bash hook, paying roughly 505 ms p95 of Node cold-start plus the `effect` / `@effect/cli` module-graph load. The hook is the inner loop of agent latency, so that cost was visible per turn. T9.2's three-layer fix is documented in [./plugin-claude.md](./plugin-claude.md) under the Bash hook section; this package is Layer 2 — the residual slow path. The binary is a Node Single Executable Application (SEA) that runs the same `injectEnv` logic with no module-graph cold-start.

## Scope: `inject-env` only

The binary handles `inject-env` and nothing else. `register-agent` stays on the JS CLI path because it pulls in a native SQLite binding (`@effect/sql-sqlite-node` → better-sqlite3) that cannot be bundled into a JavaScript SEA. `register-agent` also fires only once per session, off the per-turn critical path, so the JS cold-start is acceptable there. Restoring `register-agent` to the binary by embedding the native binding per platform is a tracked 2.x follow-up — see `.claude/notes/phase-3-sidecar-latency.md`.

## Build: tsdown SEA executable

The native binary is built with tsdown's `exe` mode (`@tsdown/exe`), which drives Node's `--experimental-sea-config` SEA generation over a single-file bundle. Each `vitest-agent-sidecar-<platform>` child owns its own `tsdown.config.ts` — identical apart from the single `exe.targets` entry. Both `build:dev` and `build:prod` run the SEA `exe` build from the child's own `src/bin.ts`: the binary is the package's only artifact, so neither mode can be a no-op. The two modes differ only in which `dist/` variants the `onSuccess` handler emits (see the distribution section below). `deps.alwaysBundle` folds every non-builtin import (`vitest-agent-cli`, `vitest-agent-sdk` and the Effect runtime they pull in) into the self-contained executable. tsdown's `exe` mode requires Node >= 25.7.0, which is why the repo's `devEngines.runtime` was bumped to 25.9.0. The parent `packages/sidecar/` builds with `@savvy-web/rslib-builder` like the other workspaces — it emits only the `src/index.ts` re-export bundle, not a binary.

Each child `tsdown.config.ts` imports the shared build helper at `lib/configs/sidecar-dist.ts` with its real `.ts` extension. tsdown loads config files with its native Node loader, which resolves import specifiers literally — it does not remap a `.js` specifier to a `.ts` source — so `biome.jsonc` carries an override disabling `useImportExtensions` for `**/tsdown.config.ts`.

The TS source is the single source of truth. The argv dispatcher — `dispatch(argv)`, the `DispatchResult` type and the hand-rolled flag parser — lives in `packages/cli/src/lib/sidecar-dispatch.ts` and is exported from `vitest-agent-cli`'s `index.ts` (alongside `injectEnv`, `registerAgentEffect`, `SidecarLive` and the path-resolution helpers). Each per-platform child package carries its own thin `packages/sidecar-<platform>/src/bin.ts` runner that imports `dispatch` from `vitest-agent-cli` as a normal package dependency — no cross-package filesystem path into another package's `src/`. The parent `packages/sidecar/` keeps only `src/index.ts`, an rslib entry re-exporting `dispatch` and `injectEnv` from the CLI for programmatic consumers. See [./cli.md](./cli.md) for the `sidecar-paths.ts` extraction.

## Distribution: per-platform optionalDependencies

Distribution follows the esbuild / sharp model. `vitest-agent-sidecar` is a parent package that carries no `bin` at all; the actual binaries ship in five sibling sub-packages, each declaring `os` / `cpu` so npm installs only the matching one:

| Sub-package | os / cpu |
| --- | --- |
| `vitest-agent-sidecar-darwin-arm64` | darwin / arm64 |
| `vitest-agent-sidecar-darwin-x64` | darwin / x64 |
| `vitest-agent-sidecar-linux-arm64` | linux / arm64 |
| `vitest-agent-sidecar-linux-x64` | linux / x64 |
| `vitest-agent-sidecar-win32-x64` | win32 / x64 |

The five sub-packages are listed as `optionalDependencies` of the parent. Each child declares the SEA binary as its own `bin` — `{ "vitest-agent-sidecar": "./bin/vitest-agent-sidecar" }`, or the `.exe` variant on win32 — so when the matching child installs the native executable lands directly on `PATH` with no intermediate shim and no resolver hop. On an unsupported platform no child installs, `vitest-agent-sidecar` is simply absent from `PATH`, and the hook's `command -v` probe misses and falls back to the JS CLI.

Each child `package.json` carries `"type": "module"` and declares `vitest-agent-cli` and `vitest-agent-sdk` as `devDependencies` — build-time only. `tsdown`'s `deps.alwaysBundle` folds them into the self-contained SEA, so they are not runtime dependencies of the published child package. A published `vitest-agent-sidecar-<platform>` package has zero runtime dependencies — the SEA binary is its only shipped artifact.

## Build transform: `sidecar-dist`

The six rslib packages publish from `dist/` variant directories emitted by `@savvy-web/rslib-builder`'s `transform()` callback. tsdown has no equivalent, so the sidecar children supply the missing piece in a shared build helper, `lib/configs/sidecar-dist.ts`. It exports two things:

- `transformManifest(manifest, variant)` — a pure function producing the publish-cleaned `package.json` written into a `dist/` variant. It keeps only publishable fields (`name`, `version`, `bin`, `files`, `os`, `cpu`, `type`, `license`, `author`, `repository`, `description`, `keywords`, `homepage`, `bugs`), drops the build-only fields (`devDependencies`, `scripts`, `publishConfig`, `packageManager`, `devEngines`), sets `private` to `false`, and — for the `github` variant only — scopes the name to `@spencerbeggs/vitest-agent-sidecar-<platform>` to match the `npm.pkg.github.com` registry. The `dev` and `npm` variants keep the bare name. No `dependencies` field is written.
- `sidecarDist({ platform, arch })` — a factory returning a tsdown `onSuccess` handler. Each child `tsdown.config.ts` wires it as its `onSuccess`. After the SEA `exe` build it renames the produced `bin/vitest-agent-sidecar-<platform>-<arch>[.exe]` to the bare `bin/vitest-agent-sidecar[.exe]`, then emits the `dist/` variant directories for the active build mode. Each variant directory holds a copy of the renamed binary, the transformed `package.json`, `README.md` and `LICENSE`. The rename is ENOENT-guarded: Turbo runs `build:dev` and `build:prod` for the same package concurrently, so if a sibling task already renamed the binary the handler verifies the destination exists and proceeds rather than failing.

The build mode is selected by the `SIDECAR_DIST_MODE` env var, which the npm `build:dev` / `build:prod` scripts set — tsdown has no `--env-mode` equivalent. `build:dev` (`SIDECAR_DIST_MODE=dev`) emits only `dist/dev`; `build:prod` (`SIDECAR_DIST_MODE=prod`) emits all three of `dist/dev`, `dist/github` and `dist/npm`. The three variants mirror the rslib packages' layout exactly: `dist/dev` is the workspace link target, `dist/github` the GitHub Packages publish target, `dist/npm` the npm registry target.

`build:prod` emits `dist/dev` too, not only the two publish targets, because the parent `vitest-agent-sidecar` package is rslib-built and its own `build:prod` resolves the workspace-protocol `optionalDependencies` on these children by reading each child's `dist/dev/package.json` (the `linkDirectory` base). A `build:prod`-only run — which is what the CI workflow does — must therefore still produce `dist/dev`, or the parent build fails with `Workspace resolution failed`.

Each child `package.json` declares a `publishConfig` with the dual npm + GitHub Packages `targets` — the same shape the six rslib packages use, pointing at `dist/npm` and `dist/github` — so the release flow publishes the sidecar children identically to the lockstep packages.

## Hook integration

The PreToolUse Bash hook (`plugin/hooks/pre-tool-use/bash.sh`) detects the binary with a cheap `command -v vitest-agent-sidecar` (a shell builtin — no fork) and execs it directly when present. When the binary is absent it falls back to `vitest-agent agent inject-env` through the project's package manager. The two paths are byte-identical in output; the binary path simply avoids Node cold-start and the PM-exec wrapper. `vitest-agent-sidecar` is declared as a `peerDependency` of `vitest-agent-plugin` alongside `vitest-agent-cli` and `vitest-agent-mcp`; it pulls in the matching `vitest-agent-sidecar-<platform>` child via `optionalDependencies`, and the child's own `bin` declaration hoists the SEA executable into `node_modules/.bin/` where the hook's `command -v` finds it.

## CI

`.github/workflows/sidecar-build.yml` cross-builds all five SEA binaries from a single macOS host (macOS, not Linux: only macOS `tar` is bsdtar, which reads the Windows Node zip the `win32-x64` target extracts) and smoke-tests each on a native runner — running `inject-env` against fixtures and diffing the output against the JS reference. After the build the `build` job runs an "Assert dist publish manifests" step that, for every `packages/sidecar-<platform>/dist/{github,npm}/package.json`, asserts the transform held: no `devDependencies`, `scripts`, `publishConfig`, `packageManager` or `devEngines`, `private` is `false`, and the `@spencerbeggs/` name scope is present in `dist/github` and absent in `dist/npm`. Publishing the sub-packages is wired into the Wave 4 release flow, not this workflow.

## Measured outcome

After T9.2, the hot path (non-Vitest commands and main-agent Vitest, caught by Layers 0 and 1 before any sidecar runs) is roughly 16 ms p95, down from ~535 ms. The subagent-binary path is roughly 88 ms p95. The JS-fallback path remains at full Node cold-start (~659 ms p95) but runs only on unsupported platforms or skipped optional dependencies. Full numbers and the launch-gate analysis are in `.claude/notes/phase-3-sidecar-latency.md`; the benchmark harness is `scripts/bench-sidecar.sh`.
