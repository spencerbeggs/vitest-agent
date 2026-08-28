---
"@vitest-agent/plugin": patch
---

## Bug Fixes

`discoverProjects` now accepts `maxDepth` and forwards it to workspace package
enumeration so deeply nested workspace packages can be discovered when callers
opt in.

- Default behavior is unchanged when `maxDepth` is omitted (the
  `@effected/workspaces` default depth still applies).
- Existing output shape and caller compatibility remain unchanged.
