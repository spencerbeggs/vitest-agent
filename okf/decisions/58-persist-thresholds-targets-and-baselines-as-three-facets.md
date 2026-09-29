---
type: Decision
status: stable
title: Persist Thresholds, Targets and Baselines as Three Facets
description: coverage_baselines gains a kind discriminator so the enforced threshold, the aspirational target, and the ratcheting baseline never collide in one row.
tags: [testing, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: e8381d28ec37578d7805d618fdbf13933cbaa8dbe5cd276a8438a695d7c5e1eb
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Persist Thresholds, Targets and Baselines as Three Facets

## Context

The system tracks three different coverage numbers per metric: the
**enforced threshold** (Vitest's `coverage.thresholds` — the
build-blocking gate), the **aspirational target** (the plugin's
`coverageTargets` — what the team is aiming for), and the **baseline**
(the auto-ratcheting high-water mark). Before this decision only the
baseline was persisted: `getCoverage` filled `CoverageReport.thresholds`
from the baseline rows because they were the only rows in
`coverage_baselines`, never populated `targets`, and folded every
`file_coverage` row into one `lowCoverage` list regardless of tier. The
MCP `test_coverage` tool then printed one `Threshold` column and one
`Files below coverage threshold` list. An agent reading the aspirational
target under the "threshold" label could mistake it for the CI gate and
spend a cycle "fixing" coverage that was never going to fail the build.

## Decision

Persist all three facets distinctly and never let one stand in for
another. `coverage_baselines` carries a `kind` column
(`'baseline' | 'threshold' | 'target'`, default `'baseline'`,
`packages/engine/src/migrations/0001_initial.ts`) and the
uniqueness key is `(project, kind, metric, pattern)`
(`0001_initial.ts`).

`DataStore.writeBaselines` (`packages/engine/src/layers/DataStoreLive.ts`)
writes only `kind='baseline'` rows and is never touched by the other two
facets. A shared upsert, `writeCoveragePolicy`
(`DataStoreLive.ts`), backs the new `writeThresholds` /
`writeTargets` methods (`DataStoreLive.ts`,
`packages/engine/src/services/DataStore.ts`): unlike the
cumulative baseline, a threshold/target write is authoritative for the
*current* configured bar, so it deletes every existing row of that
`kind` before re-inserting, all inside one transaction
(`DataStoreLive.ts`), so a metric or pattern dropped from config
can't linger as a stale enforced row and a crash mid-write can't leave
the kind partially populated. The reporter writes the resolved
thresholds and targets at the end of every full run whenever each is
configured, independent of the baseline `autoUpdate` gate — the question
"what bar am I held to" must be answerable whether or not the ratchet is
on.

A private `getCoveragePolicy(kind, project)` reader
(`packages/engine/src/layers/DataReaderLive.ts`) returns
`Option.none()` when a kind was never persisted for that project, and
`getCoverage` (`DataReaderLive.ts`) assembles `thresholds`
(`global: {}` when absent — no baseline fallback), an optional
`targets`, and `baselines` from three separate reads
(`DataReaderLive.ts`). `lowCoverage` and `belowTarget` are split
on the persisted `file_coverage.tier`: `lowCoverage` is
`tier === 'below_threshold'`, `belowTarget` is
`tier === 'below_target'` (`DataReaderLive.ts`). `test_coverage`
renders separate Enforced-threshold and Target columns and separate
Coverage Gaps / Coverage Improvements Needed sections
(surfaced through `CoverageReport.thresholds` / `.targets` /
`.lowCoverage` / `.belowTarget`, `packages/sdk/src/schemas/Coverage.ts`).
Per the repository's single-pre-2.0-migration policy this schema change
landed as an in-place edit to `0001_initial.ts` rather than a new
migration file.

**Why one table with a discriminator.** The three facets share an
identical row shape (`project`, `metric`, `pattern`, `value`,
`updated_at`) and identical upsert semantics; three separate tables
would triple the reader/writer surface for no modelling gain. The
`kind` CHECK plus the widened UNIQUE key make a collision impossible at
the database, which is the actual invariant — a row can only ever be
one facet.

**Why no fallback.** An empty `thresholds.global` is a true statement
("this project enforces nothing") that an agent can act on correctly.
Substituting the baseline turns it into a confident falsehood. The same
rule drives the split file lists: a file under the target but over the
threshold is an improvement opportunity, not a gap, and labelling it a
gap is what sent an agent chasing the wrong bar.

## Alternatives rejected

- **Three separate tables (`coverage_thresholds`, `coverage_targets`,
  `coverage_baselines`):** rejected — the three facets share an
  identical row shape and upsert semantics, so splitting them would
  triple the reader/writer surface without adding any real structure.
- **Falling back to the baseline when a threshold or target was never
  persisted:** rejected because an empty `thresholds.global` is a
  correct statement an agent can act on ("nothing enforced"), while a
  baseline substituted under the threshold label is a confident
  falsehood.
- **Folding every `file_coverage` row into one undifferentiated
  `lowCoverage` list regardless of tier:** the status quo before this
  decision; it is what let a file that merely missed an aspirational
  target read as a build-blocking gap.

## Consequences

- `test_coverage` can state, distinctly, "this is the build-blocking
  bar," "this is what the team is aiming for," and "this is the
  historical high-water mark," with no column doing double duty.
- Any new coverage-policy write path must go through
  `writeCoveragePolicy`'s kind-scoped delete-then-insert transaction
  rather than an ad hoc upsert, or it risks leaving a stale row from a
  metric or pattern dropped from config.
- A project with no configured threshold correctly renders an empty
  enforced bar instead of silently inheriting the ratcheted baseline.

## Related

- [Decision 57 — Partition the consoleLeaks Signal by Test Outcome](./57-partition-the-consoleleaks-signal-by-test-outcome.md)
