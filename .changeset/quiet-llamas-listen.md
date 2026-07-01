---
"@vitest-agent/cli": patch
---

## Maintenance

- Removed the cross-package version drift check from the CLI bin entrypoint. The `vitest-agent` CLI no longer compares its version against `@vitest-agent/sdk` at startup and no longer writes a version drift warning to stderr. The `CURRENT_CLI_VERSION` constant remains exported for version introspection.
