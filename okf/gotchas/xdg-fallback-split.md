---
type: Gotcha
status: deprecated
title: XDG data-root fallback splits between the reporter and the hook routes
description: >-
  Fixed by issue 422: with XDG_DATA_HOME unset, the reporter/MCP route and the
  hook/sidecar route now share one fallback data root, so they no longer open
  two different databases; the residual trap is the orphaned legacy file.
resource: ../../packages/engine/src/layers/PathResolutionLive.ts
tags: [dx, architecture]
stale_after: "2027-03-12T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-09-29T05:22:58Z
  body_sha256: a913a9909ebe36790460d11f01f08e47e98986b7d3a415c436aad08a43b269a2
sources:
  - id: path-resolution-live
    resource: ../../packages/engine/src/layers/PathResolutionLive.ts
  - id: hook-paths
    resource: ../../packages/engine/src/programs/hook-paths.ts
  - id: xdg-fallback-alignment-test
    resource: ../../packages/engine/__test__/xdg-fallback-alignment.test.ts
---

# XDG data-root fallback splits between the reporter and the hook routes

**Deprecated: this trap no longer exists.** The reporter/MCP route
(`resolveDataPath` over `PathResolutionLive`) and the hook/sidecar route
(`resolveHookPaths`) both configure `@effected/xdg`'s `AppDirs` with the one
shared `DATA_FALLBACK_DIR` constant (`.local/share/vitest-agent`)[^path-resolution-live][^hook-paths].
With `XDG_DATA_HOME` unset both now open
`~/.local/share/vitest-agent/<workspaceKey>/data.db`, and a hook-written row
is visible to the MCP server's `DataReader` and vice versa. A test pins the
two routes to the same directory[^xdg-fallback-alignment-test].

The trap that remains is the reporter/MCP database older versions wrote
under `~/.vitest-agent/<workspaceKey>/`, which is left in place and no
longer read; see
[Reporter and MCP history looks wiped after an upgrade but sits orphaned under ~/.vitest-agent](legacy-reporter-data-root.md).

## Related

- [Decision 31 — Deterministic XDG Path Resolution](../decisions/31-deterministic-xdg-path-resolution.md)
- [Module: engine](../modules/engine.md)

[^path-resolution-live]: `../../packages/engine/src/layers/PathResolutionLive.ts:21`
[^hook-paths]: `../../packages/engine/src/programs/hook-paths.ts:108`
[^xdg-fallback-alignment-test]: `../../packages/engine/__test__/xdg-fallback-alignment.test.ts`
