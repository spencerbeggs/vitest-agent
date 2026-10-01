---
type: Module
title: "@vitest-agent/ui"
description: The pure rendering-primitives library — the RunEvent reducer, shape-tailored dispatcher matrix, live Ink components, and synthesizers.
kind: package
layer: L2
resource: ../../packages/ui
tags:
  - architecture
  - effect
  - dx
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-01T00:18:42Z
  body_sha256: 660205b9054b1a462e4abb5827b45e5b560c2442d9a43cc7194e974cc93f7a9e
sources:
  - id: ui-src
    resource: ../../packages/ui/src/index.ts
  - id: ui-package-json
    resource: ../../packages/ui/package.json
  - id: ui-reducer
    resource: ../../packages/ui/src/reducer.ts
  - id: ui-classify
    resource: ../../packages/ui/src/dispatcher/classify.ts
  - id: ui-dispatch
    resource: ../../packages/ui/src/dispatcher/dispatch.ts
  - id: ui-footer
    resource: ../../packages/ui/src/dispatcher/footer.ts
  - id: ui-synthesize
    resource: ../../packages/ui/src/synthesize.ts
  - id: ui-pubsub-channel
    resource: ../../packages/ui/src/pubsub/Channel.ts
  - id: ui-theme
    resource: ../../packages/ui/src/theme.ts
---

# @vitest-agent/ui

## Purpose

`@vitest-agent/ui` is the pure rendering-primitives library, layer L2 with
one internal dependency (`@vitest-agent/sdk`).[^ui-package-json] One
internal event stream feeds a shape-tailored 4 × 3 dispatcher matrix. It
does not ship a reporter, a live-mount factory, or the dispatch-input
assembly helpers — those live one layer up in `@vitest-agent/reporter` (see
[Module: reporter](./reporter.md)). What this package exposes are the
dispatcher primitives, the `RunEvent` reducer, the synthesizers, and the
`RunEventChannel` PubSub: the primitives a reporter is assembled *from*. It
knows nothing about the reporter lifecycle.

`react` and `ink` are peer dependencies, not full dependencies: this
package renders *with* React/Ink but does not own the instance. Its one
consumer today, `@vitest-agent/reporter`, declares them as full
dependencies and provides the peer.[^ui-package-json]

`@effected/cli` and `@effected/env` are also peer (plus dev) dependencies,
for a different reason: `VitestAgentStatus` is exported from this package
and its type is the kit's nominal `Status`, so a consumer comparing or
extending it must resolve the same `@effected/cli` instance rather than a
private copy. `@vitest-agent/reporter` does not declare them; the carrier
`@vitest-agent/plugin` declares both as regular
dependencies.[^ui-package-json]

## Architecture at a glance

The Vitest reporter lifecycle (managed by `@vitest-agent/plugin`) emits one
`RunEvent` per callback from `AgentReporter`. Those events publish onto
`kit.runEvents` (an Effect `PubSub<RunEvent>`) and to any user-supplied
`onRunEvent` tap. `DefaultVitestAgentReporter` (in
`@vitest-agent/reporter`) subscribes to the channel, drains it through a
fiber that feeds the live Ink mount, and folds each event through this
package's reducer to update `RenderState`, which drives re-renders. At the
end of a run, the same reducer fold runs once more over a synthesized
event sequence (`synthesizeFromAgentReport`), classified by
`classifyRunShape`/`classifyOutcome`, and handed to `dispatch`/`dispatchInk`
to select one of twelve rendering cells.

One upstream, one canonical reducer fold, one dispatcher: live ingestion
and end-of-run synthesis land at the same `RenderState` shape, and the
dispatcher selects a cell purely by `(RunShape, RunOutcome)`.

## Public surface

The package entrypoint (`src/index.ts`) re-exports the rendering
primitives directly from their source files rather than through a deeper
internal barrel: the reducer (`reduceRenderState`, `reduceRenderStateAll`),
the dispatcher (`dispatch`, `dispatchInk`, `dispatcherTable`,
`classifyRunShape`, `classifyOutcome`, `buildFooter`,
`dominantClassification`), the agent and Ink render paths, the
synthesizers, the PubSub channel, the theme (`VitestAgentStatus`,
`VitestAgentStatusName`, `VitestAgentTokens`, `inkStyle`, `statusGlyph`,
`statusInkStyle`, `InkTextStyle`), and `formatDisplayDuration`.[^ui-src]
Internal code imports
directly from the source file that owns a symbol.

## Key files

### The theme: one status vocabulary

`src/theme.ts` is the only place a glyph or colour is chosen[^ui-theme].
`VitestAgentStatus` is `@effected/cli`'s core `Status` vocabulary (success,
skip, pending, info, warning, failure) extended with the three statuses a
test run adds: `timeout` (`⧖`, `#e09a4e`, rank 85, just under failure),
`running` (`…`, rank 35), and `queued` (`·`, rank 25). `VitestAgentTokens`
names the non-status accents: `classification` (`#c98ae0`, the
`[flaky]` / `[new-failure]` tag), `zero` (a zero count), `stable` (the
stable trend), and `tag` (a non-zero tag count). Because Ink takes colour
as `<Text>` props rather than ANSI, `inkStyle(token)` maps a kit token or
style onto Ink props, and `statusGlyph(name)` / `statusInkStyle(name)`
answer a status's glyph and style. `TOKEN_STYLES` mirrors the kit's
`CliTheme` defaults (which the kit does not export), and
`__test__/theme.test.ts` fails if the mirror drifts. Every Ink component,
dispatcher helper, and cell draws from this module; none carries a hex
literal of its own. The kit's semantics apply by construction: skip (`↷`)
and pending (`◯`) are dim, a regressing trend is a warning (yellow), and an
Ink coverage threshold violation is a failure (red `✗`) while a target
shortfall is a warning.

Text primitives come from the kit's `Fmt` rather than local helpers:
`truncate`, `percent` (coverage arrives on istanbul's 0–100 scale and is
divided by 100 first), `plural` (so `1 threshold violation`, never
`violation(s)`), and `duration`. `formatDisplayDuration`
(`src/format-duration.ts`) is `Fmt.duration`: whole milliseconds under a
second (`250ms`), seconds to one decimal under a minute with a trailing
`.0` dropped (`1.2s`, `1s`), then `1m 5s` and `1h 2m`; a value that rounds
up to the next unit is written in that unit (`999.6` → `1s`). It is
display only — persisted durations keep full precision.

`NO_COLOR` is still read directly by the renderers; moving that decision
to the kit is later work.

### The RunEvent taxonomy and reducer

`RunEvent` and `RenderState` are Effect Schema definitions that live in
`@vitest-agent/sdk`'s `schemas/RunEvent.ts` and `schemas/RenderState.ts`,
re-exported through this package (see [Module: sdk](./sdk.md) and
[DataModel: run-events](../models/run-events.md) for the variant
inventory). `RunEvent` is deliberately complete — one variant per Vitest
reporter hook that fits the event-sourced model.

The reducer (`src/reducer.ts`) is a pure `(state, event) => state`
function; `reduceRenderStateAll(events, seed?)` folds a full
sequence.[^ui-reducer] Because the variant union exceeds `pipe`'s
20-argument ceiling, the reducer is a single `Match.tagsExhaustive` map
keyed by `_tag` rather than a chain of per-tag `Match.when` calls — adding
a `RunEvent` variant forces an exhaustiveness compile failure until the
new key is handled, preserving that discipline as the union grows.

Most variants fold meaningfully (run/module/test lifecycle, coverage,
classification). A few load-bearing behaviors:

- `RunTimedOut` folds into a dedicated `"timed-out"` terminal `phase` on
  `RenderState` so the renderer shows a final frame instead of hanging.
- Several completeness-only variants (suite/hook lifecycle, console,
  annotations, watch mode) get no-op reducer cases: they pass through
  `Match` without changing `RenderState`, but are still delivered to every
  PubSub subscriber and the `onRunEvent` tap, so a future consumer can
  read them without a plugin change. Widening a variant's payload (as
  Vitest 5's annotation/attachment fields did) without touching the
  reducer is the whole point of the no-op case.
- A `RunFinished` optionally carries `collectedModules` — the count of
  every collected module, passing ones included — because a report replay
  only queues *failing* modules, so `moduleOrder` alone leaves a fully
  green run reporting "0 modules". The field is optional so state that
  never carried it still falls back to `moduleOrder.length`.
- A `RunFinished` also optionally carries `unhandledErrors:
  ReportError[]` — process-level errors with no owning module (an
  unhandled rejection, a worker crash). The reducer folds it onto
  `RenderState.unhandledErrors`, which is required and seeded as `[]`, so
  older `RunFinished` events leave the list empty rather than undefined.
  Before this fold, the event-sourced render path had no way to see these
  errors at all, so an unhandled-error-only run rendered green.
- `CoverageReady` folds its optional `scoped`/`scopedFiles`/`totalFiles`
  triple onto `RenderState.coverage` only when the event carries it, so an
  older emitter's event leaves the fields absent and the dispatcher treats
  the run as full. `ThresholdViolation` never arrives for a scoped run
  (the plugin suppresses it), so `coverage.violations` stays empty and the
  outcome classifies by test results alone.
- **Timeout routing.** A `TestFinished` carrying `timedOut: true` folds
  into a separate `timeoutCount` rather than `failCount`, and its
  `TestRecord.status` becomes the render-only `"timed-out"` value — Vitest
  itself reports a timed-out test as `failed`, so the split is a
  reducer-layer decision every downstream consumer of totals has to
  re-fold explicitly (see Classification below).
- `TrendComputed` — a `RunEvent` the plugin emits after end-of-run trend
  computation — folds into a nullable `trend` field on `RenderState`, so
  the live view can show a Trend line the event-sourced run lifecycle does
  not otherwise carry.

The module-lifecycle reducer cases also thread the optional `projectName`
from `ModuleQueued`/`ModuleStarted`/`ModuleFinished` onto `ModuleRecord`,
which is what lets the `stream` live component group modules by Vitest
project.

### The dispatcher matrix

A 4 × 3 cell matrix under `src/dispatcher/` is the end-of-run rendering
surface. The dispatcher reads the reduced `RenderState` plus a small
`RunShape` discriminator and selects one cell — the full cell table and
the twelve cells themselves are documented as
[DataModel: dispatcher-matrix](../models/dispatcher-matrix.md); this
module covers the surrounding machinery.

Each cell exposes two halves on the same object — an `agent(inputs,
opts): string` half tuned for token economy, and an `ink(inputs, opts):
React.ReactElement` half for the live mount. The single-test ×
threshold-violation cell is a documented no-op (a one-line all-pass result
can never carry a threshold violation), so the matrix stays total without
a default fallback.

**Classification.** `classifyRunShape(state, projects)`
(`src/dispatcher/classify.ts`) derives the `RunShape` from module count,
distinct-project count, and test count inside the module(s):
`single-test` (one module, one test), `single-file` (one module, more than
one test), `single-project` (one project, more than one module), and
`workspace` (more than one project).[^ui-classify] `classifyOutcome(state)`
derives the `RunOutcome` with a fixed precedence: real failures decide
first, then unhandled errors, then timeouts, then threshold violations,
with `all-pass` as the fallback — the first three collapse to the same
`some-fail` cell, so a run carrying more than one non-passing signal still
reads as a failure run. Two consequences of the reducer's timeout split
are load-bearing here: a run whose only non-passing signal is
`timeoutCount > 0` (with `failCount === 0`) previously fell through every
branch and classified `all-pass` — the classifier now re-folds timeouts
explicitly so a timed-out run never reads green. The same applies to
`unhandledErrors.length > 0` with otherwise-clean counts, which classifies
`some-fail` rather than hiding a process-level error behind a clean count.
`ProjectSummary` (the SDK's dispatcher contract) carries an optional
per-project `timeoutCount` so the workspace-level projects table can
attribute a timeout to the project it happened in, and picks the `✗`
glyph when either failures or timeouts are nonzero.

**Dispatch entry points** (`src/dispatcher/dispatch.ts`):
`dispatch(inputs, opts): string`, `dispatchInk(inputs, opts):
React.ReactElement | null`, and `dispatcherTable` for test
introspection.[^ui-dispatch] Both entry points append the scoped-coverage
note *after* the selected cell's output, rather than teaching each of the
twelve cells about partial runs — a private `scopedCoverageNoteFor`
returns the SDK's `formatScopedCoverageNote` output when
`state.coverage?.scoped === true` and `null` otherwise. `DispatchInputs`
itself is plain TypeScript (no Effect Schema, no persistence) and lives in
the SDK's `contracts/dispatcher.ts`; the `buildDispatchInputs` and
`resolveCellOptions` helpers that assemble it from a `ReporterRenderInput`
and a `ReporterKit` live in `@vitest-agent/reporter`, not here.

**L1 MCP tool-pointer footer.** `src/dispatcher/footer.ts` builds the
trailing pointer line(s) each cell appends, mapping outcome class to a
suggested next MCP tool call — `file_coverage` for an all-pass run with a
below-target file, `test_errors`/`failure_signature_get` for a new or
persistent failure, `failure_signature_get` alone for a flaky
classification, and `test_coverage` for a threshold-only violation.
`dominantClassification(state)` resolves which failure classification
wins with priority `new-failure → persistent → flaky → recovered →
stable`.[^ui-footer]

**Honest counts in pass cells.** Three rules keep an all-pass render from
overstating or understating what ran, applied consistently by
`render-agent.ts`'s `formatModulesSection` and the `single-project-pass`
cell: zero tests collected prints a warning and a reason to doubt the run
rather than a satisfied summary (with `timeoutCount` included in the
"did anything run" sum, since a run whose only test timed out still
collected something real); the module count comes from `collectedModules`
when present, falling back to `moduleOrder.length`; and a nonzero test
total with no knowable module count drops the "N modules all-passed" line
entirely rather than printing "0 modules all-passed".

### The `stream` live component

`src/render-ink/` holds the Ink components for `stream` console mode.
`StreamApp.tsx` is the agent-shaped, lifecycle-aware top-level component
the reporter mounts: it reads the same `RenderState` the reducer produces,
classifies the run shape on every render, and lays state out by shape —
one row per Vitest project (`workspace`), per module (`single-project`),
or per test (`single-file`/`single-test`) — rather than as an
undifferentiated file list. For the `workspace` shape it groups
`state.modules` by `projectName` and reduces each group into a per-project
rollup via the exported `buildProjectSummary(name, counts)` helper, used
at every construction site so the running rows, finished rows, and the
per-frame shape classification all agree; because the `forks` pool
interleaves modules from different projects with no project-boundary
event, each project's rollup is recomputed continuously from its member
modules on every render.

`StreamApp` is not byte-identical to the `agent` render — it is its own
renderer, agent-*shaped* but human-tuned (color, animation, no LLM-only
affordances). Sections render only when their slice of `RenderState`
exists, so the view scales by run shape: `workspace` and `single-project`
carry every section (a header, rows, a Failures block, Coverage, Trend,
and a `Total:` footer), `single-file` always keeps Total and shows
Coverage/Trend when present, and `single-test` is a single leaf line. The
one shape-independent section is `Unhandled errors:`, rendered by every
shape whenever `state.unhandledErrors` is non-empty.

A `workspace` frame with a Failures section can exceed a short terminal's
height, and Ink cannot redraw in place when that happens — `StreamApp`
renders finished `workspace`/`single-project` rows through Ink's
`<Static>` region (committed once to scrollback, never redrawn) and keeps
only the live tail (running rows, the ticking Total) in the dynamic
region, so a tall frame does not stack stale frames in scrollback.

Component files worth naming: `CountColumns.tsx` renders the four glyph
count columns (`✓ ✗ ↷ ⧖`) every aggregate row carries, right-aligned in
fixed 4-digit cells with zeros in the `zero` token, and exports the fixed
`DURATION_CELL_WIDTH` the duration cell after the counts pads to.
`TagColumns.tsx` renders per-row tag-count cells from a view-level
`tagUnion(rows)` computed once per frame — a union of one or fewer tags
collapses to empty and suppresses tag columns entirely for that view. The
spinner is a hand-rolled Braille frame array (`spinner.ts`, no
`ink-spinner` dependency) driven by the animation clock in
`@vitest-agent/reporter`'s live-mount driver, which passes the frame index
down as a prop.

### Package surface: what does not live here

The default reporter (public as `DefaultVitestAgentReporter`), the live
Ink mount driver, and the dispatch-assembly helpers
(`buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`,
`renderHumanStringForReport`) live in [Module: reporter](./reporter.md).
This split (the T6/plugin-reporter split; see the superseding rationale
under Choices absorbed here) keeps `@vitest-agent/ui` a pure primitives
library that a future non-reporter consumer — the planned MCP
triage-dashboard app is the anticipated second consumer today — could
depend on without pulling in the reporter's Ink lifecycle management.

### PubSub channel and Effect transport

`src/pubsub/` ships an Effect `PubSub<RunEvent>` channel plus a
`RunEventChannel` tag and subscriber helpers.[^ui-pubsub-channel] In
production, the plugin's `AgentReporter` creates an unbounded `PubSub` per
run, threads it onto `ReporterKit.runEvents`, and publishes one event per
Vitest streaming callback; `DefaultVitestAgentReporter` subscribes to it
for live Ink painting. The `RunEventChannel` Effect service tag and the
`Subscriber.ts` helpers (`accumulateUntilFinished`, `forEachRenderState`,
`renderStateStream`) exist for tests, Layer-based wiring, and future
remote consumers beyond the one production wiring above.

### Synthesizers

Two converters in `src/synthesize.ts` bridge into the `RunEvent`
taxonomy from the two shapes that carry run data:[^ui-synthesize]

- `synthesizeRunEvents(modules, options?)` — accepts duck-typed
  `VitestTestModule[]`, walks modules plus children, and builds a
  `RunStarted → per-module → per-test → RunFinished` sequence. Bridges any
  batch context that has the live module shape.
- `synthesizeFromAgentReport(report, options?)` — accepts the persisted
  `AgentReport`. Only failed modules carry per-test detail; passed-only
  modules summarize via `summary.passed`. Used by
  `DefaultVitestAgentReporter.render` and the CLI's replay helpers.

The two are not interchangeable: the live shape carries per-test detail
the report schema flattens away. Both thread the partial-run triple onto
`CoverageReady` and both populate `RunFinished.collectedModules`, so all
paths into the reducer agree on the collected count.
`synthesizeFromAgentReport` also gates its recomputed `ThresholdViolation`
entries on `!cov.scoped` — a scoped run's totals reflect the whole
project, so recomputing violations from thresholds vs. totals during
replay would reintroduce exactly the false verdict the live reporter
suppresses.

**Suite-load failures synthesize a failing cell.** A module that failed to
collect or import produces zero test cases, so `summary` alone would
render it green. For such a module, `synthesizeFromAgentReport` emits a
`ModuleFinished` with `failCount: 1` plus a synthetic `TestStarted`/
`TestFinished` pair labeled with the exported `SUITE_LOAD_FAILURE_LABEL`
(`"test suite failed to load"`) carrying the module's import error, and
`RunFinished.failCount` includes suite failures. Because the reducer
treats `RunFinished.failCount` as the authoritative run total, this routes
the run to a some-fail cell rather than all-pass — this is the
synthesizer-side half of the anti-false-green design this package shares
with the SDK's `buildAgentReport` (see [Module: sdk](./sdk.md)).

### CURRENT_UI_VERSION

`src/index.ts` exports `CURRENT_UI_VERSION`, inlined from
`process.env.__PACKAGE_VERSION__` at build time.[^ui-src] It was never
wired into a runtime drift check even under the earlier lockstep-versioning
design — `@vitest-agent/ui` is consumed transitively through the plugin
and is not a hard peer dependency — and cross-package version checks were
removed entirely with the move to independent per-package versioning.

## Choices absorbed here

**Compact console output.** LLM agents have limited context, so console
output is designed to maximize signal-to-noise: a single-line header with
pass/fail counts and duration rather than summary tables (counts live in
the header), no coverage totals table (only files below threshold with
uncovered lines), "next steps" phrased as specific re-run commands (or MCP
tool names), relative file paths throughout, and no redundant "All tests
passed" line. This design goal is why the twelve dispatcher cells are
hand-tuned per shape rather than generated from one generic template — a
generic renderer cannot hold this compact a bar across four very different
run shapes.

**Tiered console output.** Human-facing surfaces still need three health
tiers, resolved by `(executor, runHealth)`: green (all pass, targets met)
gets a one-line summary; yellow (pass but below targets) adds
improvements-needed detail and a CLI hint; red (failures, threshold
violations, or regressions) gets full detail plus CLI hints. Progressive
disclosure keeps a green run quiet without losing detail once problems
accumulate — the same shape-and-outcome-driven dispatch this package's
matrix generalizes for the agent-facing render path.

## Testing strategy

Five granularities, all under `packages/ui/__test__/`:

1. **Reducer unit tests** (`reducer.test.ts`) — event-by-event coverage.
2. **Classifier tests** (`classify.test.ts`) — run-shape derivation and the
   some-fail-vs-threshold-violation precedence rule.
3. **Dispatcher cell snapshots** — agent-half snapshots
   (`dispatcher/cells.snapshot.test.ts`) plus Ink-half snapshots
   (`dispatcher/cells.ink.snapshot.test.tsx`), with golden files under
   `__test__/snapshots/dispatcher/` covering all twelve cells across the
   relevant fixture event sequences.
4. **Dispatcher and footer tests** (`dispatch.test.ts`, `footer.test.ts`).
5. **Colour pins** — `render-ink/color.snapshot.test.tsx` and
   `dispatcher/cells.ink.color.snapshot.test.tsx` render Ink frames with
   colour and rewrite the ANSI into readable tags
   (`__test__/utils/ansi-tags.ts`), with goldens under
   `__test__/snapshots/render-ink/color/` and
   `__test__/snapshots/dispatcher/color/`, so a glyph or colour change
   shows up as a diff; `theme.test.ts` holds the token mirror to the kit.

Canonical fixtures in `__test__/utils/events.ts` are shared across the
first four granularities; `__test__/utils/workspace.ts` carries the
`ProjectSummary[]` fixtures the workspace cells need. The default-reporter
and live-renderer tests live in `packages/reporter/__test__/` instead —
see [Module: reporter](./reporter.md).

[^ui-src]: `../../packages/ui/src/index.ts`
[^ui-theme]: `../../packages/ui/src/theme.ts`
[^ui-package-json]: `../../packages/ui/package.json`
[^ui-reducer]: `../../packages/ui/src/reducer.ts`
[^ui-classify]: `../../packages/ui/src/dispatcher/classify.ts`
[^ui-dispatch]: `../../packages/ui/src/dispatcher/dispatch.ts`
[^ui-footer]: `../../packages/ui/src/dispatcher/footer.ts`
[^ui-synthesize]: `../../packages/ui/src/synthesize.ts`
[^ui-pubsub-channel]: `../../packages/ui/src/pubsub/Channel.ts`
