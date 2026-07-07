---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed a Vite transform bug (#133) where wrapper testers with a `(name, self, timeout)` signature — `@effect/vitest`'s `it.effect`, `it.live`, and `layer()` — were corrupted by argument rewriting, throwing "Cannot use two functions as arguments" and collecting 0 tests. Classification tags are now applied via a guarded file-level prelude at test-collection time, so every declaration form inherits them correctly: native `it`/`test`, `@effect/vitest` testers, `test.extend` aliases, numeric-timeout third-argument calls, and dynamically registered tests. Tests that already declare their own tags now merge with classification tags instead of being skipped, and files degrade to untagged (rather than failing to load) if the required Vitest runner API is unavailable.
* `@vitest-agent/cli` and `@vitest-agent/mcp` now publish as exact-pinned regular dependencies of the plugin instead of `peerDependencies`. The prior peer form could trigger pnpm's auto-install-peers resolution to pull mismatched `effect` versions into consuming projects; their bins are still hoisted automatically.
