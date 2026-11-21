---
type: Limitation
title: The plugin peers on vitest ^5.1.0 with no support for Vitest 4 or 5.0
description: "@vitest-agent/plugin and @vitest-agent/mcp declare peerDependencies.vitest as catalog:vitest:peers (^5.1.0), the plugin also its two coverage providers; a consumer on Vitest 4.x or 5.0.x cannot satisfy the peer range, and there is no dual-range compatibility shim."
bounds: ../modules/plugin.md
tags: [architecture, compat]
status: stable
generated:
  by: okfit/claude-code
  at: 2026-11-21T02:20:33Z
sources:
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: mcp-package-json
    resource: ../../packages/mcp/package.json
  - id: pnpm-workspace-catalogs
    resource: ../../pnpm-workspace.yaml
integrity:
  generated:
    body: 71d2b5b75bb82a19
---

# The plugin peers on vitest ^5.1.0 with no support for Vitest 4 or 5.0

`@vitest-agent/plugin`'s `package.json` declares `peerDependencies.vitest`
as `catalog:vitest:peers`; the same catalog reference covers
`@vitest/coverage-istanbul` and `@vitest/coverage-v8`.[^plugin-package-json]
`@vitest-agent/mcp` peers on `vitest` the same way.[^mcp-package-json]
`vitest:peers` is a catalog this repository declares itself in
`pnpm-workspace.yaml`, beside the `vitest` catalog its devDependencies
use, and it resolves every one of those peers to
`^5.1.0`.[^pnpm-workspace-catalogs] `@vitest-agent/reporter` declares no
`vitest` peer; it reaches Vitest only through the plugin that loads it.
There is no lower peer bound accepting a 4.x or 5.0.x range, and no
runtime feature-detection branch that would let the plugin degrade
gracefully under an older Vitest.

**Condition.** A consumer's project pins `vitest` to a `4.x` or `5.0.x`
release (or any range that does not satisfy `^5.1.0`).

**Symptom.** Package-manager peer resolution fails or warns depending on
strictness settings. Under 4.x, code paths that assume Vitest 5 Reporter
API shapes — `TestModule`, `TestCase`, `TestProject`, the `createReport`
scope-directory API `report-writer.ts` depends on — are absent, so even a
forced install fails at runtime rather than degrading. Under a forced
5.0.x install the 5.1-only signals are simply missing: `--last-failed` and
`--since-last-run` do not exist, `TestCase.attempts()` is absent so retry
attribution falls back to `result().errors`, and timeouts surface without
the `TestTimeoutError` / `HookTimeoutError` names.

**Why this is acceptable.** [Decision 65](../decisions/65-drop-vitest-4-require-vitest-5.md)
records why this is a floor rather than a range: several Vitest 5
behaviors this family depends on are not additive over 4.x, they are
different in ways that break the 4.x equivalent outright (a two-argument
`coverage.thresholds.autoUpdate` callback shape, glob-scoped `perFile`
that no longer inherits the top-level value, `createReport` not existing
at all under 4.x). Its 5.1 amendment records why the floor then moved to
the minor that added per-attempt results, the two rerun flags, and the
named timeout errors. Maintaining a dual range would mean permanently
untestable branches in the reporter's hot path for versions consumers are
expected to have moved off.

**What a fix would take.** Nothing planned — this is a deliberate,
recorded floor. Restoring 4.x or 5.0 support would mean re-deriving every
later-only behavior the family now depends on for its older equivalent
and carrying both indefinitely, which Decision 65 rejected as an
alternative.

[^plugin-package-json]: `../../packages/plugin/package.json:60-64`
[^mcp-package-json]: `../../packages/mcp/package.json:54-56`
[^pnpm-workspace-catalogs]: `../../pnpm-workspace.yaml:2-11`
