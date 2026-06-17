---
status: current
module: vitest-agent
category: performance
created: 2026-05-15
updated: 2026-05-23
last-synced: 2026-05-23
completeness: 92
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-flows.md
  - ./cli.md
  - ./plugin-claude.md
dependencies: []
---

# Sidecar package (`@vitest-agent/sidecar`)

The seventh publishable workspace. Sole responsibility: ship a fast-path native binary for the `inject-env` operation that fires on the per-Bash-call hot path of the PreToolUse Bash hook. It exists to eliminate Node cold-start latency from that hook without changing the hook's observable behavior.

**npm name:** `@vitest-agent/sidecar`
**Bin:** none (binaries live in per-platform child packages)
**Location:** `packages/sidecar/`
**Internal dependencies:** none (the parent package has no runtime workspace deps; `@vitest-agent/sdk` is the only workspace `devDependency` of the per-platform child packages, bundled into each SEA at build time)

For the latency problem it solves and the layered approach, see [../decisions.md](../decisions.md) Decision 42.

## Why it exists

A naive PreToolUse Bash hook shells out to the JS CLI (`vitest-agent agent inject-env`) on every Bash tool call, paying roughly 505 ms p95 of Node cold-start plus the `effect` / `@effect/cli` module-graph load. The hook is the inner loop of agent latency, so that cost is visible per turn. The three-layer fix is documented in [./plugin-claude.md](./plugin-claude.md) under the Bash hook section; this package is Layer 2 — the residual slow path. The binary is a Node Single Executable Application (SEA) that runs the same `injectEnv` logic with no module-graph cold-start.

## Scope: `inject-env` only

The binary handles `inject-env` and nothing else. `register-agent` stays on the JS CLI path because it pulls in a native SQLite binding (`@effect/sql-sqlite-node` → better-sqlite3) that cannot be bundled into a JavaScript SEA. `register-agent` also fires only once per session, off the per-turn critical path, so the JS cold-start is acceptable there.

## Build: tsdown SEA executable

The native binary is built with tsdown's `exe` mode (`@tsdown/exe`), which drives Node's `--experimental-sea-config` SEA generation over a single-file bundle. Each `@vitest-agent/sidecar-<platform>` child owns a programmatic build script at `lib/scripts/tsdown.ts` that calls tsdown's `build()` API directly — there is no static `tsdown.config.ts`. The script is identical across all four children: the target platform and arch are derived from the child's own `os` / `cpu` `package.json` fields, so it can be copied verbatim from one child to the next. A sidecar child has a single artifact, the SEA binary. `deps.alwaysBundle` folds every non-builtin import (`@vitest-agent/sdk/dispatch` and the Effect runtime it pulls in) into the self-contained executable. tsdown's `exe` mode requires Node >= 25.7.0, which is why the repo's `devEngines.runtime` was bumped to 25.9.0. The parent `packages/sidecar/` builds with `@savvy-web/rslib-builder` like the other workspaces — it emits only the `src/index.ts` re-export bundle, not a binary.

The single `lib/scripts/tsdown.ts` script backs both `build:dev` and `build:prod`; it selects its mode from `process.env.npm_lifecycle_event`. `build:dev` emits `dist/dev`; `build:prod` emits `dist/npm` and `dist/github`. Splitting the emitted directories per task gives turbo a disjoint output set per build task, so each task caches independently. The intermediate JS bundle and SEA scratch live under a per-mode `dist/.bundle/<mode>` directory and are deleted once the variant directories are written, so turbo only ever caches the final `dist/<variant>` outputs. `dist/dev` is the `linkDirectory` base the parent package links locally; `dist/npm` and `dist/github` are the publish targets.

`packages/sidecar/turbo.json` uses the normal topological task ordering — `build:dev` declares `["^build:dev"]` and `build:prod` declares `["^build:prod"]`. There is no Turbo task-graph cycle to work around: the dispatch core moved into `@vitest-agent/sdk`, so the per-platform children depend on `@vitest-agent/sdk` rather than `@vitest-agent/cli`, and the old cli → sidecar → cli edge is gone. The prior `dependsOn: []` cycle workaround was removed. The per-platform children's `turbo.json` files already used `["^build:dev"]` and are unchanged.

The TS source is the single source of truth. The argv dispatcher — `dispatch(argv)`, the `DispatchResult` type and the hand-rolled flag parser — lives in `@vitest-agent/sdk` (`packages/sdk/src/sidecar-dispatch.ts`) and is exported through the dedicated `@vitest-agent/sdk/dispatch` entry point, alongside `injectEnv` / `InjectEnvInput` and `exitCodeForTag` (see [./sdk.md](./sdk.md)). Each per-platform child package carries its own thin `packages/sidecar-<platform>/src/bin.ts` runner that does `import { dispatch } from "@vitest-agent/sdk/dispatch"` as a normal package dependency — no cross-package filesystem path into another package's `src/`. The parent `packages/sidecar/` keeps only `src/index.ts`, an rslib entry that exports `resolveSidecarBinaryPath` and `ResolveSidecarBinaryPathOptions`. The resolver **must** live in this package: `require.resolve` only finds the optional platform sub-packages when the module anchor (`import.meta.url`) is inside `@vitest-agent/sidecar`, which is the package that declares them as `optionalDependencies`. `@vitest-agent/cli` depends on `@vitest-agent/sidecar` (not the reverse) to consume this resolver. See [./cli.md](./cli.md) for the `sidecar-paths.ts` path helpers and the `agent sidecar-path` subcommand.

## Distribution: per-platform optionalDependencies

Distribution follows the esbuild / sharp model. `@vitest-agent/sidecar` is a parent package that carries no `bin` at all; the actual binaries ship in four sibling sub-packages, each declaring `os` / `cpu` so npm installs only the matching one:

| Sub-package | os / cpu |
| --- | --- |
| `@vitest-agent/sidecar-darwin-arm64` | darwin / arm64 |
| `@vitest-agent/sidecar-linux-arm64` | linux / arm64 |
| `@vitest-agent/sidecar-linux-x64` | linux / x64 |
| `@vitest-agent/sidecar-win32-x64` | win32 / x64 |

The four sub-packages are listed as `optionalDependencies` of the parent. darwin-x64 (Intel macOS) is intentionally not shipped — its Node SEA binary segfaults on startup regardless of build host, a `@tsdown/exe` / Node SEA defect for that target; Intel-Mac installs fall back to the JS CLI, which the hook's `command -v` miss already triggers when no binary is on `PATH`. Each child declares the SEA binary as its own `bin` — `{ "@vitest-agent/sidecar": "./bin/vitest-agent-sidecar" }`, or the `.exe` variant on win32 — so when the matching child installs the native executable lands directly on `PATH` with no intermediate shim and no resolver hop. On an unsupported platform no child installs, `@vitest-agent/sidecar` is simply absent from `PATH`, and the hook's `command -v` probe misses and falls back to the JS CLI.

Each child `package.json` carries `"type": "module"` and declares `@vitest-agent/sdk` as its only workspace `devDependency` — build-time only. `tsdown`'s `deps.alwaysBundle` folds it into the self-contained SEA, so it is not a runtime dependency of the published child package. A published `@vitest-agent/sidecar-<platform>` package has zero runtime dependencies — the SEA binary is its only shipped artifact.

## Build transform: publish-cleaned manifests

The six rslib packages publish from `dist/` variant directories emitted by `@savvy-web/rslib-builder`'s `transform()` callback. tsdown has no equivalent, so each sidecar child's `lib/scripts/tsdown.ts` supplies the missing piece itself with a local `transformManifest(source, variant)` function. It produces the publish-cleaned `package.json` written into a `dist/` variant: keeping only publishable fields, dropping the build-only fields (`devDependencies`, `scripts`, `publishConfig`, `packageManager`, `devEngines`), setting `private` to `false`, and — keeping the scoped `@vitest-agent/sidecar-<platform>` name. No `dependencies` field is written. After the SEA `exe` build, the script renames the produced `bin/vitest-agent-sidecar-<platform>-<arch>[.exe]` to the bare `bin/vitest-agent-sidecar[.exe]`, then writes each variant directory holding a copy of the renamed binary, the transformed `package.json`, `README.md` and `LICENSE`.

The three variants mirror the rslib packages' layout exactly: `dist/dev` is the workspace link target, `dist/github` the GitHub Packages publish target, `dist/npm` the npm registry target. `build:dev` emits `dist/dev`; `build:prod` emits `dist/npm` and `dist/github`.

The `dist/dev` variant must always be present — not only the two publish targets — because the parent `@vitest-agent/sidecar` package is rslib-built and its own `build:prod` resolves the workspace-protocol `optionalDependencies` on these children by reading each child's `dist/dev/package.json` (the `linkDirectory` base). Without `dist/dev` the parent build fails with `Workspace resolution failed`.

Each child `package.json` declares a `publishConfig` with the dual npm + GitHub Packages `targets` — the same shape the six rslib packages use, pointing at `dist/npm` and `dist/github` — so the release flow publishes the sidecar children identically to the lockstep packages.

## Hook integration

The binary is not discoverable via `command -v` because pnpm/npm only hoist direct-dependency bins — transitive optional-dependency bins are never placed in `node_modules/.bin/`. The SessionStart hook resolves the path at session start instead: it calls `vitest-agent agent sidecar-path` (a CLI subcommand backed by `resolveSidecarBinaryPath`), captures the absolute path from stdout, and writes `VITEST_AGENT_SIDECAR_BIN=<abs-path>` to both the session env file and `CLAUDE_ENV_FILE`. The PreToolUse Bash hook (`plugin/hooks/pre-tool-use/bash.sh`) Layer 2 reads `$VITEST_AGENT_SIDECAR_BIN`, checks it is non-empty and executable, and execs it directly when valid. When absent or non-executable it falls back to `vitest-agent agent inject-env` through the project's package manager. The two paths are byte-identical in output. `@vitest-agent/sidecar` reaches a consumer's install transitively rather than as a direct plugin peer: it is a regular `dependency` of `@vitest-agent/cli`, and `@vitest-agent/cli` is a required `peerDependency` of `@vitest-agent/plugin`, so installing the plugin and its auto-installed cli peer pulls the sidecar and its four per-platform `optionalDependencies` automatically.

## CI

`.github/workflows/sidecar-build.yml` has two jobs. A single `build` job on a macOS runner cross-compiles all four binaries at once — tsdown's `exe` mode downloads each target's Node runtime and postject-injects the bundle, so the host arch need not match the target — runs the `dist/{github,npm}` manifest assertions, and uploads one artifact per platform. A `smoke` matrix then downloads each binary onto its own native runner (one per supported platform) and runs it. The smoke legs carry no checkout, Node or pnpm — they exercise only the prebuilt binary, which sidesteps runtime-setup entirely.

The "Assert dist publish manifests" step, for every `packages/sidecar-<platform>/dist/{github,npm}/package.json`, asserts the transform held: no `devDependencies`, `scripts`, `publishConfig`, `packageManager` or `devEngines`, `private` is `false`, and the `@spencerbeggs/` name scope is present in `dist/github` and absent in `dist/npm`. The smoke test runs `inject-env` against fixtures and checks the unknown-subcommand exit contract. Publishing the sub-packages happens through the changesets release flow, not this workflow.

## Measured outcome

The hot path (non-Vitest commands and main-agent Vitest, caught by Layers 0 and 1 before any sidecar runs) is roughly an order of magnitude faster than the unconditional JS shell-out; the subagent-binary path sits between the two. The JS-fallback path remains at full Node cold-start but runs only on unsupported platforms or skipped optional dependencies. The benchmark harness is `scripts/bench-sidecar.sh`.
