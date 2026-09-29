---
type: Gotcha
status: draft
title: Reporter and MCP history looks wiped after an upgrade but sits orphaned under ~/.vitest-agent
description: >-
  With XDG_DATA_HOME unset, the reporter and MCP server now open
  ~/.local/share/vitest-agent/<key>/data.db, so run history they wrote to the
  legacy ~/.vitest-agent/<key>/data.db looks lost after upgrading engine; it
  is still on disk, deliberately never read or migrated.
resource: ../../packages/engine/src/layers/PathResolutionLive.ts
tags: [dx, compat]
stale_after: "2027-03-29T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-09-29T05:22:58Z
  body_sha256: e486f7147d7555c369034e96969b8d9bbb40147258ebad2e1c77ae3c5e40129a
sources:
  - id: path-resolution-live
    resource: ../../packages/engine/src/layers/PathResolutionLive.ts
  - id: hook-paths
    resource: ../../packages/engine/src/programs/hook-paths.ts
  - id: xdg-fallback-alignment-test
    resource: ../../packages/engine/__test__/xdg-fallback-alignment.test.ts
  - id: no-migration
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: "2026-09-29T00:00:00Z"
---

# Reporter and MCP history looks wiped after an upgrade but sits orphaned under ~/.vitest-agent

A user on a machine without `XDG_DATA_HOME` set upgrades to an
`@vitest-agent/engine` carrying the issue 422 fix, runs the tests, and finds
that the MCP server's history, trends, flaky classification, and failure
history start from nothing. They reasonably conclude the upgrade wiped
their database. **What is actually true:** nothing was deleted. The
reporter/MCP route used to resolve its data root through `AppDirs`' own
fallback, `~/.vitest-agent`; it now passes the shared `DATA_FALLBACK_DIR`
(`.local/share/vitest-agent`)[^path-resolution-live], the same fallback the
hook/sidecar route uses[^hook-paths], so both routes open
`~/.local/share/vitest-agent/<workspaceKey>/data.db`[^xdg-fallback-alignment-test].
The older reporter/MCP database is still at
`~/.vitest-agent/<workspaceKey>/data.db` (with any `-wal`/`-shm`
companions), untouched and no longer read.

That is deliberate: no code path migrates, merges, or deletes the legacy
file[^no-migration]. The new location may already hold a `data.db` the
hooks and the sidecar wrote before the fix, so the two files cannot be
reconciled by copying one over the other. Treat the legacy file as a
read-only archive (open it with any SQLite client) or delete it once it is
no longer wanted.

Two things this is not:

- **Not the session map.** `~/.vitest-agent/sessions.db`, the hooks'
  per-client session map (the `SESSION_MAP_HOME_DIR` fallback in
  `hook-paths.ts`), still lives directly under `~/.vitest-agent/` and is in
  active use[^hook-paths]. Only the `~/.vitest-agent/<workspaceKey>/`
  subdirectories are orphaned.
- **Not a problem with `XDG_DATA_HOME` set, or with a `cacheDir`
  override.** Both routes resolved under `$XDG_DATA_HOME/vitest-agent/`
  before and after the fix, and a programmatic or TOML `cacheDir` bypasses
  the XDG root entirely, so neither setup has a legacy file to find.

`vitest-agent db path` prints the path the current version resolves, which
is the quickest way to confirm which file is live.

## Related

- [Decision 31 — Deterministic XDG Path Resolution](../decisions/31-deterministic-xdg-path-resolution.md)
- [Module: engine](../modules/engine.md)
- [Runbook: Reset the local vitest-agent database](../runbooks/reset-the-database.md)
- [XDG data-root fallback splits between the reporter and the hook routes (deprecated)](xdg-fallback-split.md)

[^path-resolution-live]: `../../packages/engine/src/layers/PathResolutionLive.ts:21`
[^hook-paths]: `../../packages/engine/src/programs/hook-paths.ts`
[^xdg-fallback-alignment-test]: `../../packages/engine/__test__/xdg-fallback-alignment.test.ts`
[^no-migration]: conversation with the repository owner
