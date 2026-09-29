---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* `run_tests` now runs from the validated `projectRoot` for the duration of the run and restores the previous working directory afterwards, so a `projectRoot` pointing at a git worktree collects and runs that worktree's tests instead of the MCP server's boot checkout. Previously a `vitest.config.ts` calling `AgentPlugin.discover()` with no arguments located the workspace from `process.cwd()`, which inside the long-lived server was the boot checkout (#512).
