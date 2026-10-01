---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- Fixed a `Cannot find package 'redis'` crash of `vitest-agent-mcp` in packed installs by importing `@effect/platform-node` through subpaths in the `run_tests` tool.
