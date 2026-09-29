---
type: Decision
title: Per-Instance Identity from CLAUDE_PLUGIN_DATA and session_id
description: Claude Code exports no per-instance directory env var; per-instance coordination state composes CLAUDE_PLUGIN_DATA (per-plugin install dir) with the session_id every hook payload carries, since that pair is the only documented, per-window-unique surface.
status: stable
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 1f0d4a6efe24e5ff8188a2c49cfdd2de1f1a640ba4f07dec79dae1d4bb9efaaf
sources:
  - id: engine-hook-paths
    resource: ../../packages/engine/src/programs/hook-paths.ts
  - id: hooks-session-start
    resource: ../../plugins/claude-code/hooks/session/start.sh
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Per-Instance Identity from CLAUDE_PLUGIN_DATA and session_id

## Context

Coordinating state that belongs to one running Claude Code window — not
one plugin install, not one project — needs a directory or key that is
both documented and unique per window. Empirically probing the
`PreToolUse` hook's environment dump, no candidate per-Claude-instance
directory env var exists: `CLAUDE_SESSION_ENV_DIR`,
`CLAUDE_CONVERSATION_DIR`, and every other plausible name returned unset.
What Claude Code does document and export is `${CLAUDE_PLUGIN_DATA}` (a
per-plugin install directory, shared across every window running that
plugin) and the `session_id` field present in every hook's stdin JSON
payload (unique per running Claude Code window).

## Decision

Per-instance coordination state composes from those two surfaces:
`${CLAUDE_PLUGIN_DATA}/sessions/${session_id}/` is unambiguous and scoped
to exactly one Claude Code window, since `CLAUDE_PLUGIN_DATA` fixes the
plugin-owned root and `session_id` fixes the window within it. The
per-client session-map database resolves through the same variable:
`resolveSessionMapPath` in `packages/engine/src/programs/hook-paths.ts`
tries `CLAUDE_PLUGIN_DATA` first, falls back to
`VITEST_AGENT_SESSION_MAP_DIR`, and only then falls back to
`~/.vitest-agent/` under `HOME` (`USERPROFILE` on Windows)
(`packages/engine/src/programs/hook-paths.ts`). The
`session/start.sh` hook composes `VITEST_AGENT_DATA_DIR` from the same
variable when writing the canonical export set every other hook reads
via the self-source bridge (`plugins/claude-code/hooks/session/start.sh`;
see [Decision D17](d17-claude-env-file-auto-source-and-hook-self-source-bridge.md)).

## Alternatives rejected

A daemon-and-socket design — a `sidecar.sock` Unix-domain socket plus PID
sentinel files, originally specified for this same per-instance directory
— was rejected in favor of the three-layer bash prefilter and native SEA
binary on the hot path (see [Decision 42](42-three-layer-sidecar-performance-fix.md)):
cheaper to operate, with no socket lifecycle or stale-PID cleanup to
manage.

## Consequences

The `CLAUDE_PLUGIN_DATA` + `session_id` composition is the standing rule
for any future per-instance coordination state that needs only documented
surfaces — no new environment variable needs to be invented or requested
upstream. It also means per-instance state is inherently tied to the
plugin's own install directory rather than to a project or a global
location, so cleanup and lifecycle for that state follow the plugin's own
install/uninstall path rather than a project's lifecycle.
