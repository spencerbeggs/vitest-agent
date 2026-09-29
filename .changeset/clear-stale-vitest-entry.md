---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* `run_tests` now returns a `kind: "error"` result naming the missing file when the `vitest/node` entry the server resolved no longer exists on disk, and tells you to restart the vitest-agent MCP server (in Claude Code: `/mcp`). This happens when the lockfile is regenerated mid-session and pnpm moves vitest's store directory. Previously every test file failed with `[vitest-pool]: Worker forks emitted error.` and a total of 0, with no hint of the cause (#461).
