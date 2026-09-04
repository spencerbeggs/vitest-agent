---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- The served MCP schema for the `test` tool now accepts the `for_tag` action, and for the `inventory` tool now accepts the `tag` kind — both were already handled by the tRPC router but were rejected at the transport boundary before ever reaching it (#335).
- Each consolidated tool's served enum (the `test` tool's `action`, the `inventory` tool's `kind`, and their siblings) is now built from a discriminant tuple exported by the tool's own module, with a compile-time and runtime drift guard, so the MCP-SDK-side registration can no longer silently diverge from the tRPC input union (#335).
