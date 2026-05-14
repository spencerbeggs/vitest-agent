---
"vitest-agent-sdk": major
"vitest-agent-plugin": major
"vitest-agent-cli": major
"vitest-agent-mcp": major
"vitest-agent-reporter": major
"vitest-agent-ui": major
---

## Breaking Changes

### `coverageThresholds` removed from `AgentPlugin` options

`AgentPlugin({ coverageThresholds })` is no longer read. Users set Vitest's native `test.coverage.thresholds` directly — the plugin integrates with the standard Vitest config instead of duplicating its surface. The legacy preset-name string and `CoverageLevel` instance forms are gone from the plugin option; the underlying `CoverageLevel` class still ships from `vitest-agent-sdk` for users who want to compose their own thresholds.

Migration: move the threshold value into Vitest's native config and drop the plugin field.

```ts
// Before
AgentPlugin({ coverageThresholds: "standard" });

// After
const preset = AgentPlugin.COVERAGE_LEVELS.standard;
AgentPlugin({ coverageTargets: preset.coverageTargets });
// test.coverage.thresholds: preset.thresholds
```

### `coverageTargets` is now a typed schema

`AgentPluginOptions.coverageTargets` is a typed `Schema.Record` mirroring Vitest's threshold shape: per-metric positive numbers, the `100: true` value shortcut, glob-pattern entries with nested metric objects. Negatives and zero are rejected at decode time. The `perFile` key is no longer accepted on `coverageTargets` — it is inherited from `coverage.thresholds.perFile` so the two halves cannot drift.

### `AgentPlugin.COVERAGE_LEVELS.<preset>` is now dual-output

Each named preset returns `{ thresholds, coverageTargets }` instead of a `CoverageLevel` instance. The thresholds half carries the same numbers the prior `CoverageLevel.<preset>` exposed; the coverageTargets half is the next-preset-up's numbers, capped at `full`. `COVERAGE_LEVELS_PER_FILE` applies `perFile: true` only on the thresholds half.

Migration: destructure the preset and route each half to its owner.

```ts
const preset = AgentPlugin.COVERAGE_LEVELS.standard;
defineConfig({
  plugins: [AgentPlugin({ coverageTargets: preset.coverageTargets })],
  test: { coverage: { thresholds: preset.thresholds } },
});
```

### `reporterOptions.autoUpdate` removed; Vitest owns the ratchet

The plugin no longer mutates Vitest's `coverage.thresholds.autoUpdate`. The new `AgentPlugin.COVERAGE_AUTOUPDATE` namespace exposes three tolerance functions (`standard` floors, `strict` ceils, `lenient` floors minus two clamped to zero) that pass directly into Vitest's native `coverage.thresholds.autoUpdate` field — no type augmentation, no sibling option.

### Two operating modes gated by Vitest's `coverage.enabled`

`coverage.enabled: false` puts the plugin in UI-only mode: `AgentReporter.onTestRunEnd` short-circuits before persistence (no DataStore writes, no CoverageAnalyzer, no HistoryTracker resolution) while still building reports purely, resolving the renderer kit, calling the user-supplied reporter factory, and routing output. The streaming taps that drive a live renderer fire identically in both modes. Full mode (the default) runs the existing persistence pipeline unchanged.

### `ResolvedReporterConfig.coverageMode` is new and required

The reporter contract surface adds a `coverageMode: "full" | "ui-only"` field on `ResolvedReporterConfig`. Custom `VitestAgentReporterFactory` implementations can branch on this when their rendering depends on whether persistence is on. The plugin resolves the value from `vitest.config.coverage?.enabled` once during `configureVitest`.

## Features

### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET_WITHOUT_THRESHOLD warns, TARGET_BELOW_THRESHOLD errors, THRESHOLD_WITHOUT_TARGET is silent, INVALID_TARGET_VALUE errors with the offending path, UNSUPPORTED_PROVIDER errors in Full mode, MISSING_PROVIDER_PACKAGE errors with the install command, PERFILE_ON_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

### `validateCoverageTargetsShape` helper

A pure helper in `vitest-agent-sdk` returns structured `{ errors, warnings, info }` diagnostics for a `CoverageTargets` input. Rule layer consumers reuse it for the `INVALID_TARGET_VALUE` and `PERFILE_ON_TARGETS` cases.

### `CoverageLevelPreset` public type

The dual-output preset shape is exported from `vitest-agent-plugin` so user code that builds custom presets can satisfy the contract explicitly.

### Optional peer dependencies

`@vitest/coverage-v8` and `@vitest/coverage-istanbul` are declared as optional peer dependencies on `vitest-agent-plugin`. The `MISSING_PROVIDER_PACKAGE` rule surfaces the install command when the configured provider is not available.
