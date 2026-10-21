---
"@vitest-agent/ai-plugins": patch
---

## Documentation

* The `operating-vitest-agent` skill now says to restart the vitest-agent MCP server after upgrading or rebuilding `@vitest-agent/*`. The long-lived server keeps the modules it loaded at startup, so the next `run_tests` otherwise fails with an ESM link error such as `does not provide an export named ...`.
