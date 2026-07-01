---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- Fixed the discovery project cache persisting for the life of the process with no invalidation, which could serve a long-lived MCP server stale test project include-globs (and stale/"lost" test counts) after test files were added, removed, or moved on disk. The cache now self-invalidates when the on-disk test-file set changes, so moving or adding test files no longer produces phantom count drops and no restart is needed.
- Suppressed the repeated benign `[vite] (ssr) Failed to load source map` warnings that Vite core emits under v8 coverage due to missing `.js.map` files in the TypeScript npm tarball. All other Vite warnings still pass through unchanged, so console output stays clean under coverage with no config required.
