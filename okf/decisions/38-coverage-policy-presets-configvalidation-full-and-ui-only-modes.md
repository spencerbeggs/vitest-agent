---
type: Decision
title: Coverage Policy — Presets, ConfigValidation, Full and UI-only Modes
description: Dual-output coverage-level presets calibrate thresholds and aspirational targets together, coverageMode derives from Vitest's native coverage.enabled, and ConfigValidation runs a fixed rule registry over the resolved config.
status: stable
tags: [architecture, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 48fa62fb482a7a8be90c44b0c610ef7638390abc6222ba85d1186593bb9904c7
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Coverage Policy — Presets, ConfigValidation, Full and UI-only Modes

## Context

Coverage configuration touches three concerns at once: Vitest's own
enforcement knobs (`coverage.thresholds`, `coverage.thresholds.autoUpdate`,
`coverage.enabled`), the plugin's aspirational-target layer
(`coverageTargets`), and whether the persistence pipeline should run at all
when a user disables coverage outright. Splitting these into separate,
uncoordinated user inputs would let a threshold preset and a targets preset
drift out of calibration, and would leave the plugin no principled way to
decide when to skip the SQLite-backed persistence pipeline. `resolveMode`
(`packages/plugin/src/layers/ConfigValidationLive.ts`) and the
`coverageMode` field threaded through the reporter
(`packages/plugin/src/reporter.ts`) both derive from the same
Vitest-native signal rather than a plugin-specific flag.

## Decision

`coverageMode` (`"full" | "ui-only"`) lives on `ResolvedReporterConfig`
(`packages/sdk/src/contracts/reporter.ts`), not on the user-facing
`AgentReporterOptions` schema. The plugin resolves it once in
`configureVitest` from Vitest's native `coverage.enabled` field
(`coverageMode = coverageConfig?.enabled === false ? "ui-only" : "full"`,
`packages/plugin/src/plugin.ts`) and threads it through
`buildReporterKit` (`packages/plugin/src/utils/build-reporter-kit.ts`)
onto the resolved kit every reporter and cell reads. Full mode runs the
whole persistence pipeline; UI-only mode short-circuits it and renders
health-neutral output. Locking the mode as a resolved fact rather than a
user input keeps one source of truth and stops a user from declaring
`coverage.enabled: false` and a contradictory plugin-side mode in the same
config.

`AgentPlugin.COVERAGE_LEVELS` and `AgentPlugin.COVERAGE_LEVELS_PER_FILE`
(`packages/plugin/src/plugin.ts`) are dual-output preset maps: each
`CoverageLevelName` entry returns `{ thresholds, coverageTargets }`
(`CoverageLevelPreset`, `packages/plugin/src/plugin.ts`) built by
`buildPreset` (`packages/plugin/src/plugin.ts`) so a user passes the
matching halves straight into Vitest's `coverage.thresholds` and the
plugin's `coverageTargets` option from one named constant. The
`coverageTargets` half always maps to the next preset up
(`none → basic`, `basic → standard`, `standard → strict`, `strict → full`,
`full → full`, visible in the `buildPreset` call arguments at
`packages/plugin/src/plugin.ts`), so the threshold floor and the
aspirational target floor are calibrated together by default without
forcing a custom triple. `COVERAGE_LEVELS_PER_FILE` applies `perFile: true`
to the thresholds half only, because glob-pattern `coverageTargets` entries
set `perFile` per glob rather than inheriting a top-level flag under
Vitest 5.

`AgentPlugin.COVERAGE_AUTOUPDATE` (`packages/plugin/src/plugin.ts`) ships
three plain `(next: number, previous: number) => number` functions
matching Vitest's native `coverage.thresholds.autoUpdate` contract
(`boolean | ((newThreshold, previousThreshold) => number)`) directly —
`standard` floors, `strict` ceils, `lenient` floors and subtracts 2 clamped
to 0, and never returns below `previous`. There is no plugin-side wrapping
or type augmentation; Vitest owns its own ratchet and the plugin does not
fight it.

`ConfigValidation` (`packages/plugin/src/services/ConfigValidation.ts`) is
an Effect service — `validate(input: ValidationInput):
Effect<ValidationResult>` — whose Live layer
(`packages/plugin/src/layers/ConfigValidationLive.ts`) runs a fixed rule
registry (`runAllRules`, `packages/plugin/src/layers/ConfigValidationLive.ts`)
and produces a `ValidationResult` with `errors`, `warnings`, and `info`
arrays; `ValidationError` and `ValidationWarning` carry an optional `path`
for pinpointed diagnostics (`packages/plugin/src/services/ConfigValidation.ts`).
The `MISSING_PROVIDER_PACKAGE` rule
(`packages/plugin/src/layers/ConfigValidationLive.ts`) checks
installability with `createRequire(import.meta.url).resolve(packageName)`
(`packages/plugin/src/layers/ConfigValidationLive.ts`) rather than a
filesystem scan or a `package.json` lookup, so the rule fires exactly when
Vitest's own runtime resolution would also fail to load the provider; the
error's `remediation` field carries the matching install command
(`npm install --save-dev @vitest/coverage-v8` or
`@vitest/coverage-istanbul`, `packages/plugin/src/layers/ConfigValidationLive.ts`).
The test factory `ConfigValidationTest.layer` (`packages/plugin/src/layers/ConfigValidationTest.ts`)
lets tests inject pre-built results without spinning up the rule engine.

## Alternatives rejected

- **A single-output coverage-level map** (thresholds only, leaving
  `coverageTargets` to a separate uncalibrated preset or hand-authored
  config): rejected because nothing then guaranteed a user's enforcement
  floor and aspirational floor moved together; the dual-output shape makes
  the "next preset up" relationship a structural fact of the constant
  rather than a convention a user has to discover.
- **A plugin-side `autoUpdate` wrapper** duplicating or overriding Vitest's
  ratchet: rejected because Vitest 5 already exposes a function-typed
  `autoUpdate` contract; wrapping it would add an indirection layer with no
  behavior the native field could not already express, and would risk the
  two ratchets fighting over the same threshold value.
- **Filesystem or `package.json`-based provider-installed checks** instead
  of `createRequire(...).resolve`: rejected because those checks can diverge
  from what Node's module resolution would actually find (workspace
  hoisting, symlinks, `exports` maps), producing false positives or
  negatives that `createRequire` sidesteps by asking the same resolver
  Vitest itself uses.
- **A user-declared `coverageMode` option** instead of deriving it from
  `coverage.enabled`: rejected as a second way to spell a fact Vitest's own
  config already states, and as a source of contradictory configs.

## Consequences

- A custom reporter or downstream consumer that needs to know whether
  persistence ran reads `ResolvedReporterConfig.coverageMode` rather than
  re-deriving it from `coverage.enabled` itself; the derivation lives in
  exactly one place (`packages/plugin/src/plugin.ts` and its mirror in
  `packages/plugin/src/layers/ConfigValidationLive.ts`).
- Adding a new coverage-level preset means adding one entry to both
  `COVERAGE_LEVELS` and `COVERAGE_LEVELS_PER_FILE` and re-checking the
  "next preset up" mapping stays coherent at the new tier.
- A new coverage-config validation rule is added to the registry inside
  `ConfigValidationLive`, not scattered across call sites; `ConfigValidation`
  is the single place `AgentPluginOptions` and Vitest's resolved config are
  cross-checked.
- `coverageTargets` schema validation (`validateCoverageTargetsShape`) is a
  separate concern from the rule registry — see
  [Decision 40](./40-agentpluginoptions-is-exactly-five-fields.md) for how
  `coverageTargets` fits into the option surface.

## Related

- [Decision 40 — AgentPluginOptions Is a Closed, Minimal Shape](./40-agentpluginoptions-is-exactly-five-fields.md)
- [Coverage Targets](../conventions/coverage-targets.md)
