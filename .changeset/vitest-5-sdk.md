---
"@vitest-agent/sdk": minor
---

## Features

### `perFile` accepts a per-metric object

`ResolvedThresholds.perFile` is now `boolean | MetricThresholds`,
mirroring Vitest 5's widened `coverage.thresholds.perFile`. Two schemas
are newly exported: `PerFileThresholds` (the union) and
`PatternMetricThresholds` (the metric values a glob-pattern entry carries,
including its own optional `perFile`). `PatternThresholds`'s second tuple
element is now `PatternMetricThresholds`; every previously valid value
still decodes.

### `coverageTargets` glob entries accept `perFile`

Under Vitest 5 a glob-scoped threshold entry no longer inherits the
top-level `perFile`, so `CoverageTargets` glob-pattern entries now accept
their own. A top-level `perFile` is still rejected — that belongs on
`coverage.thresholds.perFile` — and the `PERFILE_ON_TARGETS` diagnostic
was reworded to say so and narrowed so it no longer fires on a legitimate
per-glob setting.

## Tests

* The shared test-layer presets record `vitestVersion: "5.0.0"`.
