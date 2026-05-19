---
"vitest-agent-sdk": major
"vitest-agent-cli": major
"vitest-agent-sidecar-darwin-arm64": major
"vitest-agent-sidecar-linux-arm64": major
"vitest-agent-sidecar-linux-x64": major
"vitest-agent-sidecar-win32-x64": major
---

## Breaking Changes

### The sidecar dispatch core moves into `vitest-agent-sdk/dispatch`

The sidecar argv-dispatch core — `dispatch` / `DispatchResult`,
`injectEnv` / `InjectEnvInput`, and `exitCodeForTag` — moves out of
`vitest-agent-cli` and into `vitest-agent-sdk`, where it ships from a
new dedicated entry point: `vitest-agent-sdk/dispatch`. The SDK now
exposes three entry points — `.`, `./dispatch`, and `./testing`. The
moved symbols ship only from `./dispatch`, never the main barrel, so
the Single Executable Application bundler's reachable graph stays
minimal — no Effect, no SQLite data layer.

`vitest-agent-cli`'s `index.ts` no longer re-exports `dispatch`,
`injectEnv`, or `exitCodeForTag`. These were internal sidecar
machinery; their canonical home is now `vitest-agent-sdk/dispatch`.
This is a clean pre-2.0 break — no compatibility re-exports are kept.
`vitest-agent-cli` still re-exports `CliLive`, `SidecarLive`,
`registerAgentEffect`, and the `sidecar-paths.ts` path helpers.

Each `vitest-agent-sidecar-<platform>` package imports `dispatch` from
`vitest-agent-sdk/dispatch` and drops `vitest-agent-cli` from its
`devDependencies`. This removes the closing edge of the
`vitest-agent-cli` → `vitest-agent-sidecar` →
`vitest-agent-sidecar-<platform>` → `vitest-agent-cli` workspace
dependency cycle: the per-platform packages now depend back only into
`vitest-agent-sdk`, which is a true leaf. `pnpm install` no longer
warns about cyclic workspace dependencies, `turbo boundaries` passes
with zero issues, and the `dependsOn: []` cycle workaround in
`packages/sidecar/turbo.json` is removed.
