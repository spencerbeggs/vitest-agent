---
"@vitest-agent/mcp": patch
---

## Bug Fixes

Fixed `run_tests` resolving `vitest/node` from `@vitest-agent/mcp`'s own install location instead of the project under test's root. Because `vitest` is a peerDependency, pnpm can materialize more than one physical instance of the same vitest version, and driving the wrong copy corrupted the module-level `SnapshotClient` singleton -- every `toMatchSnapshot()` assertion failed with "The snapshot state for '&lt;file&gt;' is not found" while every non-snapshot assertion passed. `vitest/node` is now resolved anchored at the run's validated project root via `createRequire`, falling back to the bare `"vitest/node"` specifier when no local vitest is resolvable from that root.
