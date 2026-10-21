---
type: Limitation
title: The plugin peers on vitest ^5.0.0 with no support for Vitest 4
description: "@vitest-agent/plugin, @vitest-agent/reporter, and @vitest-agent/mcp declare peerDependencies.vitest pinned to catalog:test:peers (^5.0.0); a consumer on Vitest 4.x cannot install this family at all, with no dual-range compatibility shim."
bounds: ../modules/plugin.md
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
integrity:
  generated:
    body: 7ec63128ce473b3a
---

# The plugin peers on vitest ^5.0.0 with no support for Vitest 4

`@vitest-agent/plugin`'s `package.json` declares
`peerDependencies.vitest` as `catalog:test:peers`, which the workspace
catalog resolves to `^5.0.0`; the same catalog reference covers
`@vitest/coverage-istanbul` and `@vitest/coverage-v8`.[^plugin-package-json]
There is no lower peer bound accepting a 4.x range, and no runtime
feature-detection branch that would let the plugin degrade gracefully
under an older Vitest.

**Condition.** A consumer's project pins `vitest` to a `4.x` release (or
any range that does not satisfy `^5.0.0`).

**Symptom.** Package-manager peer resolution fails or warns depending on
strictness settings, and code paths that assume Vitest 5 Reporter API
shapes — `TestModule`, `TestCase`, `TestProject`, the `createReport`
scope-directory API `report-writer.ts` depends on — are simply absent
under 4.x, so even a forced install would fail at runtime rather than
degrade.

**Why this is acceptable.** [Decision 65](../decisions/65-drop-vitest-4-require-vitest-5.md)
records why this is a floor rather than a range: several Vitest 5
behaviors this family depends on are not additive over 4.x, they are
different in ways that break the 4.x equivalent outright (a two-argument
`coverage.thresholds.autoUpdate` callback shape, glob-scoped `perFile`
that no longer inherits the top-level value, `createReport` not existing
at all under 4.x). Maintaining a dual range would mean permanently
untestable branches in the reporter's hot path for a version consumers
are expected to have moved off.

**What a fix would take.** Nothing planned — this is a deliberate,
recorded floor. Restoring 4.x support would mean re-deriving every
5.x-only behavior the family now depends on for its 4.x equivalent and
carrying both indefinitely, which Decision 65 rejected as an alternative.

[^plugin-package-json]: `../../packages/plugin/package.json:59-63`
