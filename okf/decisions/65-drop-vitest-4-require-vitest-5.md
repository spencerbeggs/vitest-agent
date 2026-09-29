---
type: Decision
title: Drop Vitest 4, Require vitest 5
description: The plugin, reporter, and MCP packages peer on vitest ^5.0.0 only, with no dual-range support, because several Vitest 5 behaviors the family relies on are actively wrong under 4.
status: stable
tags:
  - architecture
  - compat
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 9390d125d051d903540ac953894fee4af68f5fccdf7f870b7797084b48c5c1af
sources:
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: reporter-package-json
    resource: ../../packages/reporter/package.json
  - id: mcp-package-json
    resource: ../../packages/mcp/package.json
  - id: plugin-tag-ts
    resource: ../../packages/plugin/src/utils/tag.ts
  - id: plugin-plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Drop Vitest 4, Require vitest 5

## Context

Vitest 5.0.0 shipped a clean break from 4.x: removed entry points
(`vitest/coverage`, `vitest/reporters`, `vitest/environments`,
`vitest/snapshot`, `vitest/runners`, `vitest/suite`, `vitest/mocker`), a
two-argument `coverage.thresholds.autoUpdate` callback, glob-scoped
`perFile` that no longer inherits the top-level value, `minimal` as the
default agent reporter name, `findConfigFile` probing only `root` with no
ancestor walk, and `fsModuleCache` promoted to a top-level option. It also
inlined and deprecated `@vitest/runner`, which `@vitest-agent/plugin` had
carried as a direct dependency for `TestTagDefinition` and which has no
stable 5.x line on npm.

## Decision

The family drops Vitest 4 support entirely. `@vitest-agent/plugin`,
`@vitest-agent/reporter`, and `@vitest-agent/mcp` each declare
`peerDependencies.vitest` as `catalog:test:peers`, which the workspace
catalog pins to `^5.0.0`.[^plugin-package-json][^reporter-package-json][^mcp-package-json]
`TestTagDefinition` and `TestProjectInlineConfiguration` are imported from
`vitest/config` rather than the removed `@vitest/runner` package — both
`plugin.ts` and `utils/tag.ts` source the type from
there.[^plugin-plugin-ts][^plugin-tag-ts]

## Alternatives rejected

- **A dual `^4.1.0 || ^5.0.0` peer range with runtime feature detection.**
  Rejected because several of the 5.x behaviors the family depends on are
  not additive over 4.x — they are actively wrong there: the
  two-argument `autoUpdate` callback shape, per-glob `perFile` with no
  top-level inheritance, the `minimal` reporter name that the
  console-reporter strip list must recognize, `github-actions` defaulting
  its job summary on, and the config-anchoring `run_tests` needs because
  Vitest 5 no longer walks up the tree for a config file. Feature-detecting
  every one of those differences would put permanently untestable branches
  in the reporter's hot path.
- **Pin `@vitest/runner` to a legacy 4.x-compatible version indefinitely**
  to keep `TestTagDefinition` importable from its old location. Rejected
  because `@vitest/runner` has no stable 5.x release to pin a dual range
  against, and Vitest itself deprecated the package in favor of exporting
  the same types from `vitest/config` — following the upstream migration
  removes a dependency rather than adding one.

## Consequences

Dropping Vitest 4 support is a breaking change for any consumer still on
4.x, which is why the three coupled packages ship as majors alongside this
decision rather than as ordinary feature releases. `test.each` / `test.for`
titles render through `pretty-format` under 5.x and drop the quotes around
interpolated strings, so an interpolated title produces a new `full_name`
key on a project's first 5.x run — `test_history`, classification, and
trend computation all key off `full_name`, and there is no deterministic
mapping from the old key to the new one, so those tests start a fresh
history window (classifying as `new-failure` only if they then fail).
`TestOptions.sequential` no longer exists under 5.x, so `TagOptions`
(`Omit<TestTagDefinition, "name">`) loses that key along with
it.[^plugin-tag-ts] `vitest/node` exports its own `AgentReporter` (an
alias of `MinimalReporter`) under Vitest 5, which is unrelated to this
package's internal `AgentReporter` class of the same name and must not be
confused with it when reading either codebase.

## Related

- [Module: plugin](../modules/plugin.md)
- [Module: mcp](../modules/mcp.md)

[^plugin-package-json]: `../../packages/plugin/package.json`
[^reporter-package-json]: `../../packages/reporter/package.json`
[^mcp-package-json]: `../../packages/mcp/package.json`
[^plugin-plugin-ts]: `../../packages/plugin/src/plugin.ts`
[^plugin-tag-ts]: `../../packages/plugin/src/utils/tag.ts`
