---
"@vitest-agent/mcp": patch
---

## Bug Fixes

Fixes `ENOENT` errors when MCP clients read from `vitest://docs/` or `vitest-agent://patterns/` resources. The vendored Vitest documentation and curated testing pattern corpora were missing from the published package; both resource URI schemes now serve their content correctly.
