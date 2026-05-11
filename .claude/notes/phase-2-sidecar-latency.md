---
title: Phase 2 sidecar latency profile
date: 2026-05-11
related-plans: [.claude/plans/agent-agnostic-taxonomy.md]
---

## Sidecar fresh-spawn latency — measured 2026-05-11

Measured on developer laptop (macOS, Node 24.11.0, Apple Silicon). Each
sample is the wall-clock time for a complete `node <bin> _internal
<subcommand>` invocation including process startup, module loading, the
operation itself, and process exit.

## register-agent

| metric | ms |
| --- | --- |
| n | 30 |
| min | 595 |
| p50 | 617 |
| p95 | 647 |
| p99 | 1379 |
| max | 1379 |

Includes SQLite open on three databases (per-project data.db, per-client
sessions.db, registry.db), one git rev-parse subprocess, and the
idempotent agents-row INSERT.

## inject-env

| metric | ms |
| --- | --- |
| n | 30 |
| min | 492 |
| p50 | 497 |
| p95 | 505 |
| p99 | 512 |
| max | 512 |

Pure: reads package.json, runs the regex matcher, prints. No SQLite, no
git.

## Findings vs the plan's targets

The plan's targets:

- SessionStart fresh-spawn under 300ms p95 → MISSED (647ms p95)
- Daemon JSON-RPC round-trip under 50ms p95 → not yet built

Even the cheapest subcommand (inject-env, no I/O) sits at ~500ms because
Node's cold-start cost dominates: loading `effect`, `@effect/cli`,
`@effect/sql`, `@effect/sql-sqlite-node`, `vitest-agent-sdk`, plus the
better-sqlite3 native binding takes most of the budget regardless of
what the subcommand does.

## Implications

- **SessionStart (one-off per session)** at 647ms p95 is acceptable —
  the user pays it once at session start and the cost is amortized over
  the whole conversation.
- **PreToolUse Bash (fires per Bash call)** at 505ms p95 is NOT
  acceptable — every Bash invocation the agent runs gains half a
  second. This is the path the plan originally flagged for the daemon
  fallback.

## Next steps (deferred to Phase 3)

The plan documents two escape hatches in priority order:

1. **Daemon + Unix-socket JSON-RPC.** Long-running daemon launched
   eagerly from SessionStart, listening on a per-instance socket under
   `${CLAUDE_PLUGIN_DATA}/sessions/${session_id}/sidecar.sock`.
   PreToolUse Bash hook talks to it via `nc -U` or a small client
   binary. Target: under 50ms round-trip. Most aligned with the plan's
   architecture; reuses the existing Effect service graph.

2. **Bun-compiled standalone binary.** Sub-50ms cold-start in published
   benchmarks. Avoids the daemon-lifecycle complexity but requires a
   separate build pipeline and binary distribution.

3. **Pure-bash matcher for inject-env.** The inject-env logic is small
   enough to inline as a bash function (regex set + jq for env-var
   extraction). Sidesteps both daemon and Bun. Loses the
   single-source-of-truth match logic but eliminates the latency
   entirely.

Recommendation: option 3 for inject-env (cheapest fix, biggest hot path),
option 1 for register-agent if the 647ms SessionStart cost ever surfaces
as user-visible jank. Decision deferred until in-Claude-Code dogfood
flags the actual pain point.
