---
type: Module
title: "@vitest-agent/ui"
description: The pure rendering-primitives library — the RunEvent reducer, shape-tailored dispatcher matrix, and synthesizers at a React-free root, with the live Ink components and the Ink half of the matrix behind the @vitest-agent/ui/ink subpath.
kind: package
layer: L2
resource: ../../packages/ui
tags:
  - architecture
  - effect
  - dx
  - bundle
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: 3bbd9ab8d550dea956891be1a801adc6895d7398cf83972ffa255f1430ba85c9
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
  - id: ui-theme
    resource: ../../packages/ui/src/theme.ts
  - id: ui-counts
    resource: ../../packages/ui/src/counts.ts
  - id: ui-ink-entry
    resource: ../../packages/ui/src/ink/index.ts
  - id: ui-ink-dispatch
    resource: ../../packages/ui/src/ink/dispatch-ink.ts
  - id: ui-spinner
    resource: ../../packages/ui/src/spinner.ts
  - id: ui-boundaries
    resource: ../../packages/ui/__test__/boundaries.test.ts
---

# @vitest-agent/ui

## Purpose

`@vitest-agent/ui` is the pure rendering-primitives library, layer L2 with
one internal dependency (`@vitest-agent/sdk`).[^ui-package-json] One
internal event stream feeds a shape-tailored 4 × 3 dispatcher matrix. It
does not ship a reporter, a live view, or the dispatch-input
assembly helpers — those live one layer up in `@vitest-agent/reporter` (see
[Module: reporter](./reporter.md)). What this package exposes are the
dispatcher primitives, the `RunEvent` reducer, and the synthesizers: the
primitives a reporter is assembled *from*. It knows nothing about the reporter lifecycle.

The package has two entry points. The root (`.`, `src/index.ts`) never
loads React or Ink. The `./ink` subpath (`@vitest-agent/ui/ink`,
`src/ink/index.ts`) holds every Ink component and the Ink half of the
dispatcher matrix, and is the only part that imports `ink` or
`react`[^ui-ink-entry]. An agent or CI run that imports only the root
loads 451 modules rather than 1026, none of them React or Ink
([Measurement: reporter and ui import module
counts](../measurements/reporter-import-module-counts.md)). The split, and
the boundary test that holds it, are recorded in [Decision
78](../decisions/78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md).

`react` and `ink` are optional peer dependencies, not full dependencies:
this package renders *with* React/Ink but does not own the instance, and
only the `./ink` subpath needs them. Its one consumer today,
`@vitest-agent/reporter`, declares them as full dependencies and provides
the peer.[^ui-package-json]

`@effected/cli` and `@effected/env` are also peer (plus dev) dependencies,
together with `@effected/walker` and `@effected/glob`, which `@effected/cli`
itself requires as peers,
for a different reason: `VitestAgentStatus` is exported from this package
and its type is the kit's nominal `Status`, so a consumer comparing or
extending it must resolve the same `@effected/cli` instance rather than a
private copy. `@vitest-agent/reporter` declares the same four as peers
(it builds kit `Doc`s itself); the carrier `@vitest-agent/plugin` declares
all four as regular dependencies.[^ui-package-json]

## Architecture at a glance

The Vitest reporter lifecycle (managed by `@vitest-agent/plugin`) emits one
`RunEvent` per callback from `AgentReporter`. Those events publish onto
`kit.runEvents` (an Effect `PubSub<RunEvent>`) and to any user-supplied
`onRunEvent` tap. `DefaultVitestAgentReporter` (in
`@vitest-agent/reporter`) subscribes to that `PubSub` and, in `stream`
mode, hands it to the kit's `CliUi.live`, which folds each event through
this package's reducer to update `RenderState` and redraws `StreamApp`
(imported from `@vitest-agent/ui/ink` by the reporter's lazily loaded view
module). At the
end of a run, the same reducer fold runs once more over a synthesized
event sequence (`synthesizeFromAgentReport`), classified by
`classifyRunShape`/`classifyOutcome`, and handed to `dispatch` (or, for a
human report, `inkDispatcherTable` from the `./ink` subpath) to select one
of twelve rendering cells.

One upstream, one canonical reducer fold, one dispatcher: live ingestion
and end-of-run synthesis land at the same `RenderState` shape, and the
dispatcher selects a cell purely by `(RunShape, RunOutcome)`.

## Public surface

The root entrypoint (`src/index.ts`) re-exports the rendering
primitives directly from their source files rather than through a deeper
internal barrel: the reducer (`reduceRenderState`, `reduceRenderStateAll`),
the agent dispatcher (`dispatch`, `dispatcherTable`, the `Cell` and
`AgentCellFn` types, `classifyRunShape`, `classifyOutcome`, `buildFooter`,
`dominantClassification`), the agent render path (`renderAgent`), the
spinner frames (`SPINNER_FRAMES`, `SPINNER_FRAME_MS`, `spinnerFrame`), the
synthesizers and their two synthetic test names (`SUITE_LOAD_FAILURE_LABEL`,
`SUITE_FAILURE_LABEL`), SDK type re-exports such as `CoverageTotals`,
`GlobShortfall`, and `MetricThresholds`, the theme (`VitestAgentStatus`,
`VitestAgentStatusName`, `VitestAgentTokens`, `inkStyle`, `statusGlyph`,
`statusInkStyle`, `InkTextStyle`), and `formatDisplayDuration`.[^ui-src]
The theme's Ink-prop helpers stay at the root because they import only
`@effected/cli` and `@effected/cli/ui`'s `inkProps`, not `ink` or `react`.

The `./ink` subpath exports the Ink components (`StreamApp`,
`CountColumns` with `DURATION_CELL_WIDTH`, `CoverageBlock`,
`FailureSection`, `FailuresSection`, `ModuleHeader`, `ProjectRow`,
`StatusIcon`, `SuggestedActions`, `TagColumns` with `tagUnion`,
`TestRow`, `TrendLine`, each with its props type), the Ink half of the
matrix (`inkDispatcherTable`, `dispatchInk`, `InkCellFn`), and the SDK
types those signatures name, so a consumer of the subpath needs no direct
`@vitest-agent/sdk` dependency to type them[^ui-ink-entry]. Internal code
imports directly from the source file that owns a symbol.

`packages/ui/__test__/boundaries.test.ts` holds the split: no file outside
`src/ink/` may import `ink`, `react` (type-only imports and subpaths such
as `react/jsx-runtime` included), or a module under `src/ink/`, and every
`.tsx` file must live under `src/ink/`[^ui-boundaries].

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
as `<Text>` props rather than ANSI, `inkStyle(token)` resolves a kit token
or style through the kit's pure `Token.resolve` (the same resolution
`CliTheme.paint` applies) and maps it onto Ink props with the kit's
`inkProps(style)` from `@effected/cli/ui`, called with no colour level so
every prop is emitted, since `inkStyle` is a plain helper that reads no
theme and Ink's own chalk level gates what is drawn; named
colours use the chalk spelling Ink takes (`blackBright`).
`statusGlyph(name, glyphs?)` / `statusInkStyle(name)` answer a status's
glyph and style; `statusGlyph` is the kit's `VitestAgentStatus.glyph` and
returns the status's ASCII glyph when handed an ASCII `GlyphSet`. Glyph
sets are never chosen from `process` here: `StreamApp`, `StatusIcon`,
`CountColumns`, both failure sections and the `…` ellipses read the set
with the kit's `useGlyphs()` (`@effected/cli/ui`), so the host's
`CliTheme` decides (ASCII under `TERM=dumb`). Every Ink tree therefore
renders inside the kit's providers: a `CliUi.live` / `CliUi.run` screen,
or `<UiProvider value={CliUi.context}>` for a tree mounted any other way
(`renderToString`, `ink-testing-library`); the hook throws outside one. Every Ink component,
dispatcher helper, and cell draws from this module; none carries a hex
literal of its own. The kit's semantics apply by construction: skip (`↷`)
and pending (`◯`) are dim, a regressing trend is a warning (yellow), and an
Ink coverage threshold violation is a failure (red `✗`) while a target
shortfall is a warning.

Text primitives come from the kit's `Fmt` rather than local helpers:
`truncate`, `percent` (coverage arrives on istanbul's 0–100 scale, so the
call is `Fmt.percent(n, { scale: 100 })`), `plural` (so `1 threshold violation`, never
`violation(s)`), and `duration`. `formatDisplayDuration`
(`src/format-duration.ts`) is `Fmt.duration`: whole milliseconds under a
second (`250ms`), seconds to one decimal under a minute with a trailing
`.0` dropped (`1.2s`, `1s`), then `1m 5s` and `1h 2m`; a value that rounds
up to the next unit is written in that unit (`999.6` → `1s`). It is
display only — persisted durations keep full precision.

Every agent-string totals line — the dispatcher's `formatTotals` and
`formatWorkspaceTotal`, and `render-agent.ts`'s `Tests:` header with its
unhandled-errors counter — is one `formatTotalsLine` call
(`src/counts.ts`)[^ui-counts]: a kit `Doc.counts` block (inline layout,
an optional suffix such as `across 3 files`) rendered with `Render.plain`
under `Render.contextOf({ audience: "agent" })`. Its total folds timed-out
tests in but never the unhandled-error count, and that counter's label is
the kit's plural form, `{ one: "unhandled error", other: "unhandled errors"
}`, rather than a local ternary. `formatFailure`
(`dispatcher/helpers.ts`) is a kit document too: one compact `Doc.list`
item whose title is a `Doc.verbatim` (never wrapped), whose first message
line is a `Doc.line` with `truncate`, and whose diff is a `Doc.diffText`
with `truncate`, rendered with `Render.plain` for the agent audience; the
kit sanitizes the text, so a tab becomes a space. The below-target
coverage table stays hand-rolled, because the kit's pipe table is not
byte-identical to the agent output.

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
- A `RunFinished` also optionally carries `strayOutput` (what the run's
  test processes wrote straight to the terminal past Vitest's console
  capture; see [Decision
  79](../decisions/79-capture-stray-output-at-vitest-logger-streams.md)).
  The reducer copies it onto the optional `RenderState.strayOutput` only
  when present, and `synthesizeFromAgentReport` threads
  `AgentReport.strayOutput` onto the synthesized `RunFinished`. Every
  render path ends with the sdk's `formatStrayOutputNote` when it is set:
  `renderAgent` as its last section, `dispatch` and `dispatchInk` after
  the cell output and the scoped-coverage note (through the internal
  `strayOutputNoteFor`, so cells never emit it), and `StreamApp` as a
  shape-independent block under the live region, first line in the
  `warning` style. It is set only by `RunFinished`, so the live view shows
  it on the run's last frame.
- `CoverageReady` folds its optional `globShortfalls` (threshold globs
  whose aggregate coverage is below their numbers; see [the plugin
  module](plugin.md)) onto `RenderState.coverage` when present. A
  non-empty list classifies the run `threshold-violation` (see
  Classification below), and both agent surfaces — the dispatcher's
  threshold cells and `renderAgent`'s coverage section — list each one
  under `Glob aggregates below threshold:` as `- <pattern>: <metric>
  <actual> < <threshold>`, naming only the metrics that fall short,
  through the shared `formatGlobShortfallLines` /
  `formatCoverageSummaryLines` helpers in `src/dispatcher/helpers.ts`.
  When shortfalls are the only coverage failure, the judgment line reads
  `Coverage: ✗ N glob aggregates below threshold`. Both synthesizers
  thread the field through.[^ui-reducer]
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

Each root `Cell` is the agent half only — `{ agent(inputs, opts): string }`,
tuned for token economy. The Ink half is a separate table,
`inkDispatcherTable` in `src/ink/dispatch-ink.ts`, keyed by the same
matrix, whose entries are derived from the agent cells (each paints its
agent string as Ink `<Text>` rows)[^ui-ink-dispatch]. The single-test ×
threshold-violation cell is a documented no-op (a one-line all-pass result
can never carry a threshold violation), so the matrix stays total without
a default fallback.

**Classification.** `classifyRunShape(state, projects)`
(`src/dispatcher/classify.ts`) derives the `RunShape` from module count,
distinct-project count, and test count inside the module(s):
`single-test` (one module, one test), `single-file` (one module, more than
one test), `single-project` (one project, more than one module), and
`workspace` (more than one project).[^ui-classify] The module count is
`state.collectedModules` when it is known and greater than one, checked
before the `state.modules` map: on the report-replay path that map holds
only the modules that produced events (the failing ones), so a project run
with one failing file would otherwise classify `single-file` and render
that file's path over the project-wide totals. `classifyOutcome(state)`
derives the `RunOutcome` with a fixed precedence: real failures decide
first, then unhandled errors, then timeouts, then threshold violations
(per-file `coverage.violations` or any `coverage.globShortfalls` entry),
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

**Dispatch entry points**: `dispatch(inputs, opts): string` and
`dispatcherTable` at the root (`src/dispatcher/dispatch.ts`)[^ui-dispatch],
and `dispatchInk(inputs, opts): React.ReactElement | null` with
`inkDispatcherTable` behind `@vitest-agent/ui/ink`
(`src/ink/dispatch-ink.ts`)[^ui-ink-dispatch]. Both entry points append the scoped-coverage
note *after* the selected cell's output, rather than teaching each of the
twelve cells about partial runs — `scopedCoverageNoteFor` (internal to
`dispatch.ts`, reused by `dispatch-ink.ts`)
returns the SDK's `formatScopedCoverageNote` output when
`state.coverage?.scoped === true` and `null` otherwise. Both then append
the stray-output note (`strayOutputNoteFor`, likewise internal to
`dispatch.ts` and reused by `dispatch-ink.ts`) when `state.strayOutput` is
set; `dispatchInk` puts it in its own `Box` with a one-row top margin. `DispatchInputs`
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

`src/ink/` (the `@vitest-agent/ui/ink` subpath) holds the Ink components
for `stream` console mode. They lived in `src/render-ink/` before issue
562.
`StreamApp.tsx` is the agent-shaped, lifecycle-aware top-level component
the reporter's live view draws through the kit's `CliUi.live`: it reads the same `RenderState` the reducer produces,
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

`StreamApp` renders the whole run picture in one dynamic region. A
`workspace` frame with a Failures section can exceed a short terminal's
height; the kit's live renderer clamps every frame to `rows - 1` so Ink
can still redraw in place, and commits the final frame to scrollback by
unmounting at the terminal event. Nothing clamps the width.

Component files worth naming: `CountColumns.tsx` renders the four glyph
count columns (`✓ ✗ ↷ ⧖`) every aggregate row carries, right-aligned in
fixed 4-digit cells with zeros in the `zero` token, and exports the fixed
`DURATION_CELL_WIDTH` the duration cell after the counts pads to.
`TagColumns.tsx` renders per-row tag-count cells from a view-level
`tagUnion(rows)` computed once per frame — a union of one or fewer tags
collapses to empty and suppresses tag columns entirely for that view. The
spinner (`src/spinner.ts`, at the root because it is pure, no
`ink-spinner` dependency) takes its frames and
interval from the kit's glyph set — the Braille frames of `Glyphs.unicode`,
an ASCII fallback in `Glyphs.ascii`; the public `SPINNER_FRAMES` is typed
`ReadonlyArray<string>` — and its frame index is the kit live view's
`frame` (ticks of `SPINNER_FRAME_MS`), passed to `StreamApp` as a prop by
`@vitest-agent/reporter`; it never enters `RenderState`[^ui-spinner].

### Package surface: what does not live here

The default reporter (public as `DefaultVitestAgentReporter`), the live
view (`startLiveView`), and the dispatch-assembly helpers
(`buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`,
`renderHumanStringForReport`) live in [Module: reporter](./reporter.md).
This split (the T6/plugin-reporter split; see the superseding rationale
under Choices absorbed here) keeps `@vitest-agent/ui` a pure primitives
library that a future non-reporter consumer — the planned MCP
triage-dashboard app is the anticipated second consumer today — could
depend on without pulling in the reporter's live-view lifetime.

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

**Suite-level failures synthesize a failing cell.** A module in
`report.failed` with no failed test case and no timeout failed at the
suite level, which `summary` alone would render green. For such a module,
`synthesizeFromAgentReport` emits a `ModuleFinished` with `failCount: 1`
plus a synthetic `TestStarted`/`TestFinished` pair carrying the module's
first error, and `RunFinished.failCount` includes suite failures. The
pair's test name depends on whether the module collected tests: none (an
import error or top-level throw) is labeled with the exported
`SUITE_LOAD_FAILURE_LABEL` (`"test suite failed to load"`); one or more
(the file loaded, but a `beforeAll` / `afterAll` hook threw) is labeled
with the exported `SUITE_FAILURE_LABEL` (`"test suite failed"`), so a
hook failure is never reported as a load failure.[^ui-synthesize] Because the reducer
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
5. **Colour pins** — `ink/color.snapshot.test.tsx` and
   `dispatcher/cells.ink.color.snapshot.test.tsx` render Ink frames with
   colour and rewrite the ANSI into readable tags
   (`__test__/utils/ansi-tags.ts`), with goldens under
   `__test__/snapshots/render-ink/color/` and
   `__test__/snapshots/dispatcher/color/`, so a glyph or colour change
   shows up as a diff; `theme.test.ts` holds the token mirror to the kit.
   `ink/StatusIcon.cliui.test.tsx` mounts a reporter-owned Ink
   component through the kit's `CliUiTest.view`
   (`@effected/cli/ui/testing`).

The Ink component tests live in `__test__/ink/`, mirroring `src/ink/`
(they were under `__test__/render-ink/` before issue 562; the colour
goldens keep their `snapshots/render-ink/` path).
`__test__/boundaries.test.ts` is the React-free-root guard described under
Public surface.

Canonical fixtures in `__test__/utils/events.ts` are shared across the
first four granularities; `__test__/utils/workspace.ts` carries the
`ProjectSummary[]` fixtures the workspace cells need. The default-reporter
and live-renderer tests live in `packages/reporter/__test__/` instead —
see [Module: reporter](./reporter.md).

[^ui-src]: `../../packages/ui/src/index.ts`
[^ui-theme]: `../../packages/ui/src/theme.ts`
[^ui-counts]: `../../packages/ui/src/counts.ts`
[^ui-package-json]: `../../packages/ui/package.json`
[^ui-reducer]: `../../packages/ui/src/reducer.ts`
[^ui-classify]: `../../packages/ui/src/dispatcher/classify.ts`
[^ui-dispatch]: `../../packages/ui/src/dispatcher/dispatch.ts`
[^ui-footer]: `../../packages/ui/src/dispatcher/footer.ts`
[^ui-synthesize]: `../../packages/ui/src/synthesize.ts`
[^ui-ink-entry]: `../../packages/ui/src/ink/index.ts`
[^ui-ink-dispatch]: `../../packages/ui/src/ink/dispatch-ink.ts`
[^ui-spinner]: `../../packages/ui/src/spinner.ts`
[^ui-boundaries]: `../../packages/ui/__test__/boundaries.test.ts`
