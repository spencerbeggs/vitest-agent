---
"@vitest-agent/mcp": major
---

## Breaking Changes

### Requires Vitest 5

The `vitest` peer range moves to `^5.0.0`. Vitest 4 is no longer
supported, and `vite` must now be installed explicitly because Vitest 5
declares it as a required peer rather than a regular dependency.

### `run_tests` rejects a `projectRoot` with no reachable config

Vitest 5 probes only the given `root` for a config file and no longer
walks up through ancestor directories. A `run_tests` call passing an
explicit `projectRoot` that points at a package subtree previously found
the workspace config by that upward walk; under Vitest 5 it would find
nothing, run on pure defaults, never load `AgentPlugin`, write no rows,
and still report success.

`run_tests` now resolves the config itself and passes it alongside the
caller's verbatim `root`. When no `vitest.config.*` or `vite.config.*`
exists at or above the supplied `projectRoot` within the repository, the
call returns an error envelope naming the path instead of a silent
empty pass.

## Bug Fixes

* `run_tests` moved to the non-deprecated
  `createVitest(options, viteOverrides, vitestOptions)` overload; the
  `mode` first argument is deprecated in Vitest 5.

## Dependencies

| Dependency | Type | Action | From | To |
| :--------- | :--- | :----- | :--- | :-- |
| vitest | peerDependency | updated | ^4.1.0 | ^5.0.0 |
