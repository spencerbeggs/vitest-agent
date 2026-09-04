---
"@vitest-agent/sdk": minor
---

## Features

- `DataStore.writeThresholds` / `DataStore.writeTargets` persist the resolved, enforced `coverage.thresholds` and the aspirational `coverageTargets` for a run as distinct facets alongside the ratcheted `coverage_baselines` rows (#237).
- `CoverageReport` gains `targets` and `baselines` fields (alongside the existing enforced `thresholds`) and a `totalFiles` field for rendering "N of M test files" notes.
- New `formatScopedCoverageNote(testedFileCount, totalFileCount?)` helper renders the "Coverage thresholds skipped: partial run (N of M test files)" note; the `CoverageReady` `RunEvent` variant and `RenderState.coverage` now carry `scoped` / `scopedFiles` / `totalFiles` (#160).

## Bug Fixes

- `getCoverage` now returns `lowCoverage` (below the enforced threshold, build-blocking) and `belowTarget` (above threshold but below the aspirational target) as separate tiers instead of only ever reporting against the enforced threshold, so a file failing its aspirational target no longer reads as a build-blocking failure (#237).
- The `coverage_baselines` table gained a `kind` column (`baseline` / `threshold` / `target`) in the `0001_initial` migration to store the three facets in one table. This is a pre-2.0 schema change with no migration path — reset an existing local `data.db` with `vitest-agent db reset`.
