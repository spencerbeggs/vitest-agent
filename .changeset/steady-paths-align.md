---
"@vitest-agent/engine": patch
---

## Bug Fixes

* With `XDG_DATA_HOME` unset, the reporter and MCP server now store `data.db` under `~/.local/share/vitest-agent/<workspaceKey>/`, the same directory the Claude Code hooks and sidecar use. Previously they fell back to `~/.vitest-agent/<workspaceKey>/`, so the two halves could write to different databases. Closes #422.
* Upgrade note: an existing `~/.vitest-agent/<workspaceKey>/data.db` is not migrated and is no longer read, so history starts fresh at the new location. Move `data.db` (plus its `-wal` and `-shm` files) by hand to keep it. Users who set `XDG_DATA_HOME` are unaffected.
* The fallback directory is now exported as `DATA_FALLBACK_DIR` alongside `APP_NAMESPACE`.
