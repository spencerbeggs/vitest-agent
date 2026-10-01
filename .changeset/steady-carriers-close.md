---
"@vitest-agent/plugin": minor
---

## Features

- Reporters are closed when Vitest closes, so a custom reporter's `close()` hook runs after the last run.
- `VITEST_AGENT_CONSOLE` values match case-insensitively, and invalid values get clearer diagnostics.

## Bug Fixes

- `CI=false` no longer enables the CI retry rule.
- Debug log lines are emitted only at the `debug`, `trace`, or `all` log level.
- `vitest-agent-mcp` no longer crashes with `Cannot find package 'redis'` in packed installs; `@effect/platform-node` is now imported through subpaths.
