---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* Fixed the `test` tool's attachment budgeting to charge each inline body its actual wire length instead of its decoded `byteSize` — a base64-encoded body was undercounted by about a third, letting responses overrun `maxBytes`
