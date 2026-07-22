---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* The `hypothesis` tool's `record` action now accepts a `tddTaskId` (number or numeric string) to bind the hypothesis deterministically to the session the TDD task was opened under; an unknown `tddTaskId` now fails with a typed error instead of silently misattributing the hypothesis. `sessionId` remains only as a dev/test fallback and is no longer the primary binding path.
* Synced the MCP-SDK-side `hypothesis` tool registration to declare and forward `tddTaskId` — previously it was wired only on the tRPC side, making the deterministic binding unreachable from real MCP clients.
* The server's recovered session context now heals lazily at the first tool call from the Claude Code plugin's per-session env files when boot-time recovery found nothing, surviving both a fresh-launch boot race and a `/reload-plugins` restart.
* Exposed `buildMcpServer` (transport-free server construction for testing served tool schemas), `parseSessionEnvExports`, and `recoverSessionContextFromSessionEnv` as public exports.
