---
"@vitest-agent/cli": patch
"@vitest-agent/engine": patch
"@vitest-agent/mcp": patch
"@vitest-agent/plugin": patch
"@vitest-agent/reporter": patch
"@vitest-agent/ui": patch
---

## Maintenance

- Moved onto the `@effected` 0.21 catalog, which renamed the kit libraries this package builds on: `@effected/cli` is now `@effected/cli-kit`, `@effected/mcp` is now `@effected/mcp-kit`, and `@effected/engine` is now `@effected/kit`. Imports changed only. The public API and runtime behavior stay the same.
