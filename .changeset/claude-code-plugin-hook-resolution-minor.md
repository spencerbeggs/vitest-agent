---
"@vitest-agent/claude-code-plugin": minor
---

## Features

* Hook CLI resolution (`detect_vitest_agent_bin`) no longer falls back to `<pm> exec vitest-agent`. The order is now: `VITEST_AGENT_CLI_CMD` override → relative `node_modules/.bin/vitest-agent` → `PATH` → fail open.
* The MCP loader's `npx` fallback is now pinned to `@vitest-agent/mcp@5`, matching the major version shipped by this release.

## Documentation

* Updated remediation documentation to reflect the engine's `hint` field (renamed from `humanHint`) and added guidance to read `structuredContent` only from MCP tool results.
