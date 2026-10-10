---
type: Decision
title: Three-Layer Sidecar Performance Fix
description: A bash regex prefilter, a main-agent-identity skip, and a native SEA binary on the residual path replace an unconditional JS CLI shell-out on every Bash tool call, avoiding a daemon's socket and lifecycle cost.
status: stable
tags: [architecture, performance, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: bf8bf684f86e1ec164eaaca769be59e4c38a04fe351a1fc471abcedf5f7bb4f8
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Three-Layer Sidecar Performance Fix

## Context

The PreToolUse Bash hook (`plugin/hooks/pre-tool-use/bash.sh`)
fires on every Bash tool call. A naive implementation would unconditionally
shell out to the JS CLI's `inject-env` subcommand to detect a Vitest
invocation and rewrite its env-var prefix, paying a full Node cold start —
the `effect` / `effect/cli` / `@effect/sql-sqlite-node` module
graph — on the inner loop of agent latency. Most of that work is wasted:
the large majority of Bash calls cannot invoke Vitest at all, and
main-agent Vitest invocations already carry correct attribution through
their auto-sourced session environment. Only Bash calls made by a subagent
whose active identity differs from the main agent genuinely need the
rewrite.

## Decision

Three layers, each cheaper than the one before it, filter down to the
residual case that needs a real rewrite. Layer 0 is a POSIX-ERE regex
matched against the raw command with bash's built-in `[[ =~ ]]`
(`SIDECAR_PREFILTER_RE`, `plugin/hooks/pre-tool-use/bash.sh`)
— no fork, no subprocess. A non-match emits a no-op and exits immediately.
Layer 1 compares `VITEST_AGENT_AGENT_ID` against
`VITEST_AGENT_MAIN_AGENT_ID` after sourcing the session-env file
(`plugin/hooks/pre-tool-use/bash.sh`) and skips the
sidecar entirely when the active actor is the main agent; it falls through
(does not skip) when either var is unset, since paying the sidecar cost is
safer than silently dropping attribution. Layers 0 and 1 together eliminate
the sidecar call from the large majority of Bash calls. Layer 2 is the
`@vitest-agent/sidecar` binary
(`plugin/hooks/pre-tool-use/bash.sh`) invoked directly
when `VITEST_AGENT_SIDECAR_BIN` is set and executable; the hook falls back
to the JS CLI (`cli agent inject-env`) when the binary is absent or
non-executable, with byte-identical output either way.

A persistent daemon was rejected in favor of this layered prefilter: a
daemon removes the cold start but adds a per-instance socket, a lifecycle
to manage, and a coordination directory — machinery the near-free Layer
0/1 bash checks plus a binary on the residual path make unnecessary. The
layered design runs no background process, opens no socket, and leaves
nothing to clean up.

Layer 2's binary is built with `@savvy-web/bundler`'s `exe` mode
(`exe: { fileName: "vitest-agent-sidecar" }`,
`packages/sidecar-darwin-arm64/savvy.build.ts`), which drives Node's
Single Executable Application generation from a single-file bundle. The
parent `@vitest-agent/sidecar` package carries no `bin` of its own and
cross-builds nothing (`packages/sidecar/savvy.build.ts`) — each of the
four `sidecar-<platform>` child packages compiles its own binary from its
own `src/bin.ts` and declares it as its own `bin`; the parent only declares
the four children as `optionalDependencies` and exposes the pure
`resolveSidecarBinaryPath` helper
(`packages/sidecar/src/resolve-sidecar-binary-path.ts`) from its
programmatic `.` export.

The binary handles `inject-env` only; `register-agent` stays on the JS
CLI. `register-agent` pulls in the full SDK data-layer graph
(`@effect/sql-sqlite-node` on Node's built-in `node:sqlite`) that the
trimmed `inject-env` SEA bundle deliberately excludes, and it fires once
per session, off the per-turn critical path, so its JS cold start is
tolerable there in a way a per-Bash-call cold start is not.

The binary ships per-platform via four `optionalDependencies` sub-packages
declaring matching `os`/`cpu` fields (`SUPPORTED_PLATFORMS`,
`packages/sidecar/src/resolve-sidecar-binary-path.ts` — darwin-arm64,
linux-arm64, linux-x64, win32-x64; darwin-x64 is intentionally not
shipped). The binary is not discoverable via `command -v` because
pnpm/npm only hoist direct-dependency bins, never transitive
optional-dependency bins, into `node_modules/.bin/`. Instead,
`resolveSidecarBinaryPath()`
(`packages/sidecar/src/resolve-sidecar-binary-path.ts`) resolves the
absolute path via `createRequire(import.meta.url)`-backed resolution
anchored inside the sidecar package, the `optionalDependencies` owner. The
SessionStart hook calls `vitest-agent agent sidecar-path`
(`packages/cli/src/commands/agent.ts`) once per session
(`plugin/hooks/session/start.sh`), captures the
absolute path from stdout, and sets it as the `VITEST_AGENT_SIDECAR_BIN`
session value.
Layer 2 reads this env var directly instead of probing `PATH`. When the var
is absent or the binary non-executable — an unsupported platform, or a
skipped optional dependency — the hook falls back to the JS CLI, degrading
attribution accuracy gracefully rather than breaking the Bash call.

Numeric results for this design live in
[the sidecar hook latency measurement](../measurements/sidecar-hook-latency.md);
the benchmark harness is `scripts/bench-sidecar.sh`.

## Alternatives rejected

- **A long-running daemon** amortizing the Node cold start across Bash
  calls: rejected because it trades a per-call cost for a persistent
  process, a socket, a lifecycle, and a coordination directory — overhead
  the layered prefilter avoids entirely for a problem where most calls
  never need the sidecar at all.
- **Bun as the SEA runtime** instead of Node's own Single Executable
  Application generation: rejected in earlier spikes for the Bun/Node
  mixing pain it introduced; `@savvy-web/bundler`'s `exe` mode stays inside
  the Node ecosystem via tsdown/Rolldown.
- **Shipping `register-agent` through the same trimmed SEA bundle** as
  `inject-env`: rejected because `register-agent` needs the full SDK
  data-layer graph the trimmed bundle deliberately excludes, and it runs
  only once per session, off the hot path, where the JS cold start does
  not matter.
- **Discovering the sidecar binary via `command -v` / `PATH`**: rejected
  because pnpm/npm never hoist a transitive optional dependency's bin into
  `node_modules/.bin/`; `resolveSidecarBinaryPath` reading the package
  graph directly is the only reliable resolution path.

## Consequences

- Any Bash-call attribution logic added later must account for all three
  layers — a change to session-env variable names or to the sidecar's CLI
  contract has to be mirrored in `bash.sh`, the SessionStart hook, and
  `resolveSidecarBinaryPath`'s platform map, or the fallback chain silently
  degrades to the slower path everywhere.
- A platform without a matching `sidecar-<platform>` package (only
  darwin-x64 today) always falls back to the JS CLI; adding sidecar support
  for a new platform means adding both a `SUPPORTED_PLATFORMS` entry and a
  new `sidecar-<platform>` child package with its own `exe` build.
- The binary's trimmed scope (inject-env only) means any future hook logic
  that needs database access cannot simply be added to the sidecar binary
  without either accepting the full SDK data-layer graph in the SEA bundle
  or keeping that logic on the JS CLI path instead.

## Related

- [Measurement: sidecar-hook-latency](../measurements/sidecar-hook-latency.md)
- [Module: sidecar](../modules/sidecar.md)
- [Module: claude-code-plugin](../modules/claude-code-plugin.md)
