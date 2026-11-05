---
"@vitest-agent/mcp": patch
---

## Features

On the stateless `2026-07-28` MCP revision, `tools/list` and `prompts/list` responses now carry a one-hour private cache hint, so clients can reuse the tool and prompt lists instead of refetching them.
