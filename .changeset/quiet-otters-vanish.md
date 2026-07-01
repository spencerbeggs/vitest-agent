---
"@vitest-agent/mcp": minor
---

## Refactoring

### Removed the MCP resource subsystem

The four MCP resources served under the `vitest://docs/` and `vitest-agent://patterns/` URI schemes have been removed, along with the vendored Vitest documentation corpus, the curated patterns library, and the snapshot-maintenance build pipeline that generated them.

Removing the resource corpus also fixes a boot failure ("cannot locate the served corpus") that occurred when the server was built with `@savvy-web/bundler` 1.0.0 or later.

All 29 tRPC-backed tools and the six framing prompts are unaffected. Agents that fetched documentation or pattern content via resource URIs should instead read the equivalent content from the public docs site at vitest-agent.dev; there is no direct resource-URI replacement.
