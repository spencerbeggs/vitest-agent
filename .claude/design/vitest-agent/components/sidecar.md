---
status: current
module: vitest-agent-reporter
category: performance
created: 2026-05-15
updated: 2026-05-15
last-synced: 2026-05-15
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

The binary is built with tsdown's `exe` mode (`@tsdown/exe`), which drives Node's `--experimental-sea-config` SEA generation over a single-file bundle. `build:prod` sets `VITEST_AGENT_SIDECAR_EXE=1` to switch `tsdown.config.ts` into executable output; `build:dev` emits a plain bundle. tsdown's `exe` mode requires Node >= 25.7.0, which is why the repo's `devEngines.runtime` was bumped to 25.9.0.

The TS source is the single source of truth. `packages/sidecar/src/bin.ts` re-uses `injectEnv` from `vitest-agent-cli` rather than re-implementing the rewrite — the CLI's `index.ts` re-exports `injectEnv` (plus `registerAgentEffect`, `SidecarLive` and the path-resolution helpers) for exactly this reason. See [./cli.md](./cli.md) for the `sidecar-paths.ts` extraction.

## Distribution: per-platform optionalDependencies

Distribution follows the esbuild / sharp model. `vitest-agent-sidecar` is a parent package whose `bin` points at a CommonJS launcher shim (`bin/launcher.js`); the actual binaries ship in five sibling sub-packages, each declaring `os` / `cpu` so npm installs only the matching one:

| Sub-package | os / cpu |
| --- | --- |
| `vitest-agent-sidecar-darwin-arm64` | darwin / arm64 |
| `vitest-agent-sidecar-darwin-x64` | darwin / x64 |
| `vitest-agent-sidecar-linux-arm64` | linux / arm64 |
| `vitest-agent-sidecar-linux-x64` | linux / x64 |
| `vitest-agent-sidecar-win32-x64` | win32 / x64 |

The five sub-packages are listed as `optionalDependencies` of the parent. On an unsupported platform npm logs a warning but the install succeeds with no binary present; the hook's `command -v` probe catches that case and falls back to the JS CLI. `bin/launcher.js` resolves the matching sub-package's binary at runtime and execs into it.

## Hook integration

The PreToolUse Bash hook (`plugin/hooks/pre-tool-use/bash.sh`) detects the binary with a cheap `command -v vitest-agent-sidecar` (a shell builtin — no fork) and execs it directly when present. When the binary is absent it falls back to `vitest-agent agent inject-env` through the project's package manager. The two paths are byte-identical in output; the binary path simply avoids Node cold-start and the PM-exec wrapper. `vitest-agent-sidecar` is declared as a `peerDependency` of `vitest-agent-plugin` alongside `vitest-agent-cli` and `vitest-agent-mcp`, so standard bin hoisting puts it in `node_modules/.bin/` where the hook's `command -v` finds it.

## CI

`.github/workflows/sidecar-build.yml` cross-builds all five SEA binaries from a single Linux host and smoke-tests each on a native runner — running `inject-env` against fixtures and diffing the output against the JS reference. Publishing the sub-packages is wired into the Wave 4 release flow, not this workflow.

## Measured outcome

After T9.2, the hot path (non-Vitest commands and main-agent Vitest, caught by Layers 0 and 1 before any sidecar runs) is roughly 16 ms p95, down from ~535 ms. The subagent-binary path is roughly 88 ms p95. The JS-fallback path remains at full Node cold-start (~659 ms p95) but runs only on unsupported platforms or skipped optional dependencies. Full numbers and the launch-gate analysis are in `.claude/notes/phase-3-sidecar-latency.md`; the benchmark harness is `scripts/bench-sidecar.sh`.
