---
status: current
module: vitest-agent
category: architecture
created: 2026-05-12
updated: 2026-09-04
last-synced: 2026-09-04
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../schemas.md
  - ../decisions.md
  - ./plugin.md
  - ./sdk.md
  - ./cli.md
  - ./reporter.md
dependencies: []
---

# UI package (`@vitest-agent/ui`)

The pure rendering-primitives library. One internal stream feeds a shape-tailored 4 × 3 dispatcher matrix. The default reporter and the live Ink mount live in `@vitest-agent/reporter`, not here: `@vitest-agent/ui` does not ship a reporter, a live-mount factory or the dispatch-input helpers. It exposes the dispatcher primitives, the `RunEvent` reducer, the synthesizers and the `RunEventChannel` PubSub — the primitives a reporter is assembled *from*. It knows nothing about the reporter lifecycle.

**npm name:** `@vitest-agent/ui`
**Location:** `packages/ui/`
**Internal dependencies:** `@vitest-agent/sdk`
**Consumers:** `@vitest-agent/reporter` (the only consumer today; the planned MCP triage-dashboard app is the anticipated second — see D34 / D41)

**Key external dependencies:**

- `react`, `ink` — peer deps for the Ink half of every dispatcher cell. `@vitest-agent/ui` renders *with* React/Ink but does not own the instance; its concrete consumer `@vitest-agent/reporter` declares them as full dependencies and provides the peer.
- `effect` — Schema, Match, PubSub, Stream, Layer, Context

---

## Architecture at a glance

```text
┌─────────────────────────────────────────────────────────────────┐
│            Vitest reporter lifecycle (managed by @vitest-agent/plugin)        │
│  onTestRunStart → onTestModuleQueued → onTestCaseResult → …      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (per-callback emit in AgentReporter)
                       ┌──────────────┐
                       │   RunEvent   │  discriminated union
                       └──────────────┘
                              │
            PubSub.publish onto kit.runEvents + user onRunEvent tap
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   DefaultVitestAgentReporter         user-supplied onRunEvent tap
   (in @vitest-agent/reporter):        (optional, every mode)
   subscribes kit.runEvents,                  │
   drain fiber feeds createLiveInk            ▼
              │                          user callback
              ▼
   reducer.event → ink.rerender (ui primitives)
                              │
                              ▼
                       end-of-run render(input, kit)
                              │
                              ▼
           reduceRenderStateAll(synthesizeFromAgentReport(report))
           classifyRunShape + classifyOutcome
           dispatch(inputs, opts) → string  (ui primitives)
```

`@vitest-agent/ui` supplies the boxed primitives — the reducer, the synthesizers, the classifiers and the dispatcher. The orchestration around them (subscribing the channel, the drain fiber, the Ink mount lifecycle, the end-of-run render) lives in `DefaultVitestAgentReporter` in `@vitest-agent/reporter`. One upstream, one canonical reducer fold, one dispatcher: live ingestion and end-of-run synthesis land at the same `RenderState` shape, and the dispatcher selects a cell by `(RunShape, RunOutcome)`.

---

## The RunEvent taxonomy and reducer

Schemas live in `packages/sdk/src/schemas/RunEvent.ts` and `packages/sdk/src/schemas/RenderState.ts`, re-exported through `@vitest-agent/ui`. The `RunEvent` surface is complete — one variant per Vitest 4.x reporter hook that fits the event-sourced model; see [../schemas.md](../schemas.md) for the variant inventory and [./plugin.md](./plugin.md) for the hook-to-variant mapping the plugin emits.

The reducer (`packages/ui/src/reducer.ts`) is the pure `(state, event) => state` function; `reduceRenderStateAll(events, seed?)` is the fold helper. The variant union exceeds `pipe`'s 20-argument ceiling, so the reducer is a single `Match.tagsExhaustive` map keyed by `_tag` rather than a chain of per-tag `Match.when` calls. Adding a `RunEvent` variant forces an exhaustiveness compile failure until the new key is handled — `tagsExhaustive` preserves that discipline.

Most variants fold meaningfully (run / module / test lifecycle, coverage, classification). `RunTimedOut` folds into a dedicated `"timed-out"` terminal `phase` on `RenderState` so the renderer shows a final frame instead of hanging. The completeness variants that exist purely so the surface is whole (suite / hook lifecycle, console, annotations, watch mode — see the union in `packages/sdk/src/schemas/RunEvent.ts`) get no-op reducer cases: they pass through `Match` without changing `RenderState`, but are still delivered to every PubSub subscriber and the `onRunEvent` tap, so a future analytics consumer or the MCP dashboard receives them without any plugin change.

The module-lifecycle reducer cases also thread the optional `projectName` from `ModuleQueued` / `ModuleStarted` / `ModuleFinished` onto `ModuleRecord`, which is what lets `StreamApp` group modules by Vitest project.

`RunFinished` also folds an optional `collectedModules` — the count of every collected module, passing ones included — onto `RenderState`. `moduleOrder` cannot stand in for it: a report replay only queues *failing* modules, so a fully-green run leaves `moduleOrder` empty and every "N modules all-passed" line read "0 modules" (issue #204). The field is optional, so state that never carried it (older replay data, hand-built fixtures) still falls back to `moduleOrder.length`.

`RunFinished` likewise carries an optional `unhandledErrors: ReportError[]` — process-level errors with no owning module (an unhandled rejection, a worker crash). The reducer folds it onto `RenderState.unhandledErrors`, which is required and seeded as `[]` by `initialRenderState`, so a `RunFinished` that never carried the field leaves the list empty rather than undefined. Before this the event-sourced render path had no way to see these errors at all — only the persisted `AgentReport` did — so an unhandled-error-only run rendered green (issue #240; see the classification and `StreamApp` sections below and Decision 48 in [../decisions.md](../decisions.md)).

`CoverageReady` folds its optional `scoped` / `scopedFiles` / `totalFiles` onto `RenderState.coverage` (issue #160) — each only when the event carries it, so a `CoverageReady` from an older emitter leaves the fields absent and the dispatcher treats the run as full. `ThresholdViolation` never arrives for a scoped run (the plugin suppresses it), so `coverage.violations` stays empty and the outcome classifies by test results alone.

Two reducer behaviors are load-bearing for `StreamApp`'s state needs. **Timeout routing** — a `TestFinished` carrying `timedOut: true` folds into a separate `timeoutCount` rather than `failCount`, and its `TestRecord.status` becomes the render-only `"timed-out"` value; Vitest reports a timed-out test as `failed`, so the split is a reducer-layer concern (see [../schemas.md](../schemas.md)). **`TrendComputed`** — a `RunEvent` variant the plugin emits after end-of-run trend computation; the reducer folds it into a nullable `trend` field on `RenderState` so `StreamApp` can show a Trend line that the event-sourced run lifecycle does not otherwise carry.

---

## The dispatcher matrix

A 4 × 3 cell matrix in `packages/ui/src/dispatcher/` is the rendering surface. The dispatcher reads the reduced `RenderState` plus a small `RunShape` discriminator and selects one cell:

| | all-pass | some-fail | threshold-violation |
| - | - | - | - |
| single-test | `renderSingleTestPass` | `renderSingleTestFail` | `renderSingleTestThreshold` (no-op) |
| single-file | `renderSingleFilePass` | `renderSingleFileFail` | `renderSingleFileThreshold` |
| single-project | `renderSingleProjectPass` | `renderSingleProjectFail` | `renderSingleProjectThreshold` |
| workspace | `renderWorkspacePass` | `renderWorkspaceFail` | `renderWorkspaceThreshold` |

The 12 cells live under `packages/ui/src/dispatcher/cells/`. Each cell exposes two halves on the same object — an `agent(inputs, opts): string` half tuned for token economy and an `ink(inputs, opts): React.ReactElement` half for the live mount. The `Cell` shape lives in `packages/ui/src/dispatcher/cell-types.ts`.

The single-test × threshold-violation cell is a documented no-op: a one-line "all-pass" result can never carry a threshold violation, so the cell returns the empty string and the matrix stays total without a default fallback. See `packages/ui/src/dispatcher/cells/single-test-threshold.ts`.

### Classification

`classifyRunShape(state, projects)` in `packages/ui/src/dispatcher/classify.ts` derives the `RunShape` from module count, distinct-project count and test count inside the module(s):

- `single-test` — exactly one module, one test.
- `single-file` — one module, more than one test.
- `single-project` — one project, more than one module.
- `workspace` — more than one project.

`classifyOutcome(state)` derives the `RunOutcome`. Precedence: `some-fail` (any failures) wins over `some-fail` (any unhandled errors), which wins over `some-fail` (any timeouts), which wins over `threshold-violation`; `all-pass` otherwise. The first three collapse to the same cell — the ordering is about which signal *decides*, and real failures decide first so a run with both reads as a failure run.

**Timeouts are not passes (issue #224).** A run whose only non-passing signal is `totals.timeoutCount > 0` (with `failCount === 0`) previously fell through every branch and classified `all-pass`, routing a timed-out run into a green cell. The reducer deliberately splits timeouts out of `failCount` (see the reducer section above — Vitest reports a timed-out test as `failed`, and the split is what lets the renderer say "timed out" rather than "failed"), so the classifier has to re-fold them explicitly. Three render paths do the same fold on the counts: `render-agent.ts`'s `formatHeader`, the shared `formatTotals` helper, and the `single-file-fail` cell all add `timeoutCount` into the denominator and emit an `N timed out` part between the failed and skipped parts.

**Unhandled errors are not passes either (issue #240).** A run whose only non-passing signal is `unhandledErrors.length > 0` (all counts clean) classifies `some-fail` — a green-looking count must never hide a process-level error behind an all-pass cell. `render-agent.ts`'s `formatHeader` appends an `N unhandled error(s)` part after the skipped count, and `renderAgent` emits an `Unhandled errors:` section (first line of each message, plus the stack when `includeStack` is set) directly after the Failures section.

**Known gap.** `ProjectSummary` carries no per-project `timeoutCount`, so the workspace-level projects table cannot attribute timeouts to a project even though the totals line and outcome class are now correct. Tracked as issue #242.

### Dispatch entry points

```ts
dispatch(inputs: DispatchInputs, opts: CellOptions): string
dispatchInk(inputs: DispatchInputs, opts: CellOptions): React.ReactElement | null
dispatcherTable                                                    // for test introspection
```

**Scoped-coverage note — one choke point (issue #160).** Both entry points append the note *after* the selected cell's output rather than teaching each of the 12 cells about partial runs. A private `scopedCoverageNoteFor(inputs)` returns `formatScopedCoverageNote(coverage.scopedFiles ?? 0, coverage.totalFiles)` when `state.coverage?.scoped === true` and `null` otherwise. `dispatch` joins it to the agent string with a newline; `dispatchInk` wraps the cell's element and a `<Text>` row in a column `<Box>` via `createElement` (the module is `.ts`, shared by both halves, so no JSX). The cells' own threshold-flavored coverage lines still print — the note is what tells the reader to disregard them.

`DispatchInputs` is plain TypeScript (no Effect Schema, no persistence) and lives in `packages/sdk/src/contracts/dispatcher.ts`. It carries `state`, `shape`, `outcome`, the per-project aggregates the workspace cells need (`ProjectSummary[]`), the optional trend summary and below-target file list, plus the resolved `runCommand`. The `buildDispatchInputs` and `resolveCellOptions` helpers that assemble these from a `ReporterRenderInput` and a `ReporterKit` no longer live in this package — they moved to `@vitest-agent/reporter` with the default reporter. See [./reporter.md](./reporter.md).

### L1 MCP tool-pointer footer

`packages/ui/src/dispatcher/footer.ts` builds the trailing pointer line(s) that each cell appends. The mapping:

| Outcome class | Pointer |
| ------------- | ------- |
| all-pass with at least one below-target file | `Use file_coverage to find uncovered functions.` |
| some-fail with `new-failure` or `persistent` classification | `Use test_errors for failure detail; failure_signature_get to check known patterns.` |
| some-fail with `flaky` classification | `Use failure_signature_get to confirm the flakiness signature.` |
| threshold-violation only | `Use test_coverage for the workspace coverage breakdown.` |

`dominantClassification(state)` resolves the dominant failure classification with priority `new-failure → persistent → flaky → recovered → stable`.

### Honest counts in pass cells

Three rules keep an all-pass render from overstating (or understating) what ran. They apply to both `render-agent.ts`'s `formatModulesSection` and the `single-project-pass` cell, which mirror each other deliberately.

1. **Zero tests is a warning, not a green.** When `passCount + failCount + skipCount + timeoutCount` is 0, the renderer prints `0 tests collected.` plus the reason-to-doubt sentence (wrong working directory, a filter that matched nothing, or a load-time error) instead of a satisfied summary. `timeoutCount` is in the sum on purpose: a run whose only test timed out has zero pass/fail/skip but a real collected test, and must not be described as collecting nothing.
2. **The module count comes from `collectedModules` when present**, falling back to `moduleOrder.length` / the tracked module records. This is the #204 fix — see the reducer section above.
3. **No knowable module count means no module sentence.** A nonzero test total with a zero module count (no `collectedModules`, no tracked modules) drops the "N modules all-passed" line entirely rather than printing "0 modules all-passed". `formatModulesSection` returns `null` for the same state.

`formatTotals` appends an `across N files` suffix to the totals line whenever `collectedModules` is present and nonzero, so the file count rides the line every cell already prints.

### Cell helpers

`packages/ui/src/dispatcher/helpers.ts` holds the shared formatters every cell uses: totals header, failure block, coverage judgment line, trend line, the projects table with name padding and tag-count suffix, the workspace total footer and the below-target table. `packages/ui/src/dispatcher/ink-helpers.tsx` exports `renderAgentStringAsInk`, which wraps an agent string in colored Ink `<Text>` rows so cells can share their agent-half output as a default Ink render.

`formatBelowTargetTable` sizes its file column to the longest path among the printed rows (`TABLE_COL_FILE_MIN = 60` as the floor) instead of truncating at a fixed 60 columns, so a printed path is never cut off (issue #237 follow-up). Only the first `limit` rows enter the width calculation; the omitted rows are summarized by the `… N more` footer and never affect layout.

### Shared duration formatter

`packages/ui/src/format-duration.ts` exports `formatDisplayDuration` — the one display formatter the whole package uses. It rounds sub-second milliseconds to one decimal place and keeps the ≥1s → seconds behavior. `render-agent.ts`, the dispatcher helpers, the `render-ink/` components and `StreamApp` all call it; it replaced three inconsistent inline formatters. It is display-only — full-precision durations still persist to the database unchanged.

---

## The `stream` live component

`packages/ui/src/render-ink/` holds the Ink components for `stream` console mode.

`StreamApp.tsx` is the agent-shaped, lifecycle-aware top-level component the reporter mounts. It reads the same `RenderState` the reducer produces, classifies the run shape each render via `classifyRunShape`, and lays the state out by run shape — one row per Vitest project (`workspace`), per module (`single-project`), or per test (`single-file` / `single-test`) — rather than as an undifferentiated file list. For the `workspace` shape it groups `state.modules` by `projectName` and reduces each group into a per-project rollup using the existing `ProjectSummary` shape; it also merges each group's per-module `tagCounts` into a per-project tag-count map and computes the view-level tag union once per frame, threading both into `ProjectRow`. The `single-project` shape computes the same union over the module `tagCounts` for its module rows. Because the `forks` pool interleaves modules from different projects with no project-boundary event, each project's running state and rollup are computed continuously from its member modules on every render.

`StreamApp` is not byte-identical to `agent` mode — it is its own renderer, agent-*shaped* but human-tuned (color, animation, no LLM-only affordances). Its layout mirrors the agent view's structure and grows downward: a `Projects (N):` / `Modules (N):` / file-path header, then rows, then (for aggregate shapes) a `Failures (N):` section, then Coverage, Trend and a bottom `Total:` line. Aggregate rows lay out in fixed columns — counts, duration and tag cells share widths across rows — and in the `workspace` shape the `Total:` line pads its label so its counts align directly under the project-row count columns. There is no top summary line. Sections render only when their slice of `RenderState` exists, so they scale by run shape — `workspace` and `single-project` carry every section, `single-file` always keeps Total and shows Coverage / Trend when the run produced them, `single-test` is a single leaf line and nothing else. The one shape-independent section is `Unhandled errors:` — rendered by every shape, `single-file` and `single-test` included, whenever `state.unhandledErrors` is non-empty. The aggregate Failures section is omitted by the leaf shapes because each failure is expanded inline under its own `✗` row and would otherwise print twice; a process-level error has no owning row to expand under, so it gets the same standalone block in every shape (`UnhandledErrorItem`: a red `✗ unhandled error` line plus the dimmed first line of the message). See issue #240.

`render-ink/` components: `ProjectRow.tsx` is the leaf for the `workspace` shape's per-project rows. `CountColumns.tsx` renders the four glyph count columns — pass `✓`, fail `✗`, skip `↷`, timeout `⧖` — that every aggregate row (project, module) carries; counts render right-aligned in fixed 4-digit cells with two-space gaps so columns line up across rows, zeros dimmed. It also exports `DURATION_CELL_WIDTH`, the fixed width the duration cell after the counts pads to (re-exported from the `render-ink` barrel). `TagColumns.tsx` renders the fixed-width tag-count cells aggregate rows carry from `ModuleRecord.tagCounts` and exports the `tagUnion(rows)` helper: the view computes the union of tag names across all rows each frame and every row renders every union tag as a `tag:` label plus a 4-digit right-aligned count (zero dimmed gray, nonzero cyan), so tag columns align too; a union of one or fewer tags collapses to empty and the whole view suppresses tag columns — this view-level suppression replaced the earlier per-row `tag:count` suffix (`tag-suffix.ts` / `formatTagSuffix`, deleted). `FailuresSection.tsx` is the capped `Failures (N):` block for the aggregate shapes (`workspace`, `single-project`), which cannot expand errors inline; leaf-row shapes expand the error inline under the `✗` row instead. `TrendLine.tsx` is the one-line Trend renderer fed from `RenderState.trend`. `StatusIcon` carries a `"timed-out"` kind (glyph `⧖`). `spinner.ts` is a small helper exposing a hand-rolled Braille frame array — no `ink-spinner` dependency. The spinner frame index and the ticking elapsed column are driven by the animation clock in `@vitest-agent/reporter`'s `createLiveInk`, which passes the wall-clock-derived frame index to `StreamApp` as a prop; see [./reporter.md](./reporter.md).

Tall-output handling: a `workspace` frame with a Failures section can exceed a short terminal's height, and Ink cannot redraw in place when that happens. `StreamApp` renders finished `workspace` / `single-project` rows through Ink's `<Static>` region — committed once to scrollback, never redrawn — and keeps only the live tail (running rows, the ticking Total) in the dynamic region, so a tall frame does not stack stale frames in scrollback.

---

## The default reporter does not live here

The default reporter (public as `DefaultVitestAgentReporter`), the live Ink mount driver and the dispatch helpers (`buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`, `renderHumanStringForReport`) live in `@vitest-agent/reporter` — see [./reporter.md](./reporter.md). `@vitest-agent/ui` is the layer those things are *built from*; it ships only the dispatcher primitives, the reducer, the synthesizers and the PubSub channel.

---

## Package surface

The package entrypoint (`packages/ui/src/index.ts`) re-exports the rendering primitives directly from their source files: the reducer (`reduceRenderState`, `reduceRenderStateAll`), the dispatcher (`dispatch`, `dispatchInk`, `dispatcherTable`, `classifyRunShape`, `classifyOutcome`, `buildFooter`, `dominantClassification`), the agent and Ink render paths, the synthesizers and the PubSub channel. Internal code imports directly from the source file that owns the symbol — there is no barrel beyond the entrypoint.

---

## PubSub channel and Effect transport

`packages/ui/src/pubsub/` ships an Effect `PubSub<RunEvent>` channel plus `RunEventChannel` tag and subscriber helpers. The production wiring uses a `PubSub<RunEvent>`: the plugin's `AgentReporter` creates an unbounded `PubSub` per run, threads it onto `ReporterKit.runEvents`, and publishes one event per Vitest streaming callback; `DefaultVitestAgentReporter` subscribes to it for live Ink painting. See [./plugin.md](./plugin.md) and [./reporter.md](./reporter.md) for that flow. The `RunEventChannel` Effect service tag and the `Subscriber.ts` helpers (`accumulateUntilFinished`, `forEachRenderState`, `renderStateStream`) remain for tests, Layer-based wiring and future remote consumers.

---

## Synthesizers

Two converters in `packages/ui/src/synthesize.ts`:

- `synthesizeRunEvents(modules, options?)` — accepts duck-typed `VitestTestModule[]`. Walks modules plus children, builds a `RunStarted → per-module → per-test → RunFinished` sequence. Bridge for any batch context that has the live module shape.
- `synthesizeFromAgentReport(report, options?)` — accepts the persisted `AgentReport`. Only failed modules carry per-test detail; passed-only modules summarize via `summary.passed`. Used by `DefaultVitestAgentReporter.render` (in `@vitest-agent/reporter`) and the CLI helpers.

Both synthesizers thread the partial-run triple onto `CoverageReady`: `synthesizeRunEvents` from the supplied `SynthesizedCoverage` (which gained optional `scoped` / `scopedFiles` / `totalFiles`), `synthesizeFromAgentReport` from `CoverageReport.scoped` / `scopedFiles.length` / `totalFiles`. `synthesizeFromAgentReport` also gates its recomputed `ThresholdViolation` entries on `!cov.scoped` — a scoped run's totals reflect the whole project, so recomputing violations from thresholds vs totals during replay reintroduced exactly the false verdict the live reporter suppresses (a latent replay bug fixed with issue #160).

Both synthesizers populate `RunFinished.collectedModules` — `synthesizeRunEvents` from the walked module count, `synthesizeFromAgentReport` from `report.summary.modules` when the report carries it. The plugin's live `RunFinished` emit does the same, so all three paths into the reducer agree on the collected count. `synthesizeFromAgentReport` also copies `report.unhandledErrors` onto `RunFinished.unhandledErrors` when non-empty, matching the plugin's live emit (which forwards Vitest's `onTestRunEnd` argument), so the end-of-run `agent` render and the live `stream` render see the same process-level errors (issue #240).

**Suite-load failures synthesize a failing cell.** A module that failed to *collect / import* produces zero test cases, so `summary` alone would render it green. For such a module `synthesizeFromAgentReport` emits a `ModuleFinished` with `failCount: 1` plus a synthetic `TestStarted` / `TestFinished` pair labeled `SUITE_LOAD_FAILURE_LABEL` (`"test suite failed to load"`, exported from `synthesize.ts`) carrying the module's import error, and `RunFinished.failCount` includes suite failures. Because the reducer treats `RunFinished.failCount` as the authoritative run total, this routes the run to the some-fail render cell instead of the all-pass cell. This is the synthesizer-side half of the false-green fix; see Decision 45 in [../decisions.md](../decisions.md).

---

## Testing strategy

Four granularities:

1. **Reducer unit tests** (`__test__/reducer.test.ts`).
2. **Classifier tests** (`__test__/classify.test.ts`) — covers run-shape derivation and the some-fail-vs-threshold-violation precedence rule.
3. **Dispatcher cell snapshots** — agent-half snapshots in `__test__/dispatcher/cells.snapshot.test.ts` plus Ink-half snapshots in `__test__/dispatcher/cells.ink.snapshot.test.tsx`, with golden files under `__test__/snapshots/dispatcher/` covering the 12 cells across the relevant fixture event sequences.
4. **Dispatcher and footer tests** — `__test__/dispatch.test.ts`, `__test__/footer.test.ts`. The default-reporter and live-renderer tests live in `packages/reporter/__test__/`.

Canonical fixtures in `__test__/utils/events.ts` are shared across all four granularities; `__test__/utils/workspace.ts` carries the `ProjectSummary[]` fixtures the workspace cells need. (These moved out of `__test__/fixtures/` because the `@savvy-web/bundler` 2.0.2 tsconfig excludes a `fixtures/` directory from typecheck; the self-contained fixture *projects* under `mcp/` and `plugin/` stay excluded via their own tsconfigs.)

---

## Decisions reference

See `../decisions.md` for the recorded design choices:

- D37 — per-executor console matrix.
- D40 — `AgentPluginOptions` is exactly five fields; `reporter` is a single override hook and `onRunEvent` is a stream-tee with no gating.
- D41 — shape-tailored dispatcher matrix and the trade-off against the per-formatter pipeline.
- D48 — honest run reporting: collected counts, self-correcting reasons, and why timeouts must be re-folded as non-passing by every consumer of the totals.
- D59 — partial-run detection and the scoped-coverage note appended by both dispatch entry points.

---

## CURRENT_UI_VERSION

`packages/ui/src/index.ts` exports `CURRENT_UI_VERSION` (inlined from `process.env.__PACKAGE_VERSION__` via the package's `rslib.config.ts` `define`), part of the public API. It was never wired into a runtime drift check even under the earlier lockstep design — `@vitest-agent/ui` is consumed transitively through the plugin and is not a hard peer dependency — and the cross-package version checks were removed entirely with the move to independent per-package versioning. See D36 in [../decisions.md](../decisions.md).
