---
status: current
module: vitest-agent-ui
category: architecture
created: 2026-05-12
updated: 2026-05-19
last-synced: 2026-05-19
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
dependencies:
  - vitest-agent-sdk
---

# UI package (`vitest-agent-ui`)

The pure rendering-primitives library. The T6 UI rewrite collapsed the pre-2.0 per-formatter pipeline plus the dual ingestion paths into one internal stream that lands at a shape-tailored 4 × 3 dispatcher matrix. The reporter-package restructure (`feat/2.0-reporter-restructure`) then moved the default reporter and the live Ink mount *out* of this package into `vitest-agent-reporter`: `vitest-agent-ui` no longer ships a reporter, a live-mount factory or the dispatch-input helpers. It exposes the dispatcher primitives, the `RunEvent` reducer, the synthesizers and the `RunEventChannel` PubSub — the primitives a reporter is assembled *from*. It knows nothing about the reporter lifecycle.

**npm name:** `vitest-agent-ui`
**Location:** `packages/ui/`
**Internal dependencies:** `vitest-agent-sdk`
**Consumers:** `vitest-agent-reporter` (the only consumer today; the planned MCP triage-dashboard app is the anticipated second — see D34 / D41)

**Key external dependencies:**

- `react`, `ink` — peer deps for the Ink half of every dispatcher cell. `vitest-agent-ui` renders *with* React/Ink but does not own the instance; its concrete consumer `vitest-agent-reporter` declares them as full dependencies and provides the peer.
- `effect` — Schema, Match, PubSub, Stream, Layer, Context

---

## Architecture at a glance

```text
┌─────────────────────────────────────────────────────────────────┐
│            Vitest reporter lifecycle (vitest-agent-plugin)        │
│  onTestRunStart → onTestModuleQueued → onTestCaseResult → …      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (per-callback emit in AgentReporter)
                       ┌──────────────┐
                       │   RunEvent   │  discriminated union, 23 variants
                       └──────────────┘
                              │
            PubSub.publish onto kit.runEvents + user onRunEvent tap
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   DefaultVitestAgentReporter         user-supplied onRunEvent tap
   (in vitest-agent-reporter):        (optional, every mode)
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

`vitest-agent-ui` supplies the boxed primitives — the reducer, the synthesizers, the classifiers and the dispatcher. The orchestration around them (subscribing the channel, the drain fiber, the Ink mount lifecycle, the end-of-run render) lives in `DefaultVitestAgentReporter` in `vitest-agent-reporter`. One upstream, one canonical reducer fold, one dispatcher: live ingestion and end-of-run synthesis land at the same `RenderState` shape, and the dispatcher selects a cell by `(RunShape, RunOutcome)`.

---

## The RunEvent taxonomy and reducer

Schemas live in `packages/sdk/src/schemas/RunEvent.ts` and `packages/sdk/src/schemas/RenderState.ts`, re-exported through `vitest-agent-ui`. The `RunEvent` surface is complete — one variant per Vitest 4.x reporter hook that fits the event-sourced model; see [../schemas.md](../schemas.md) for the variant inventory and [./plugin.md](./plugin.md) for the hook-to-variant mapping the plugin emits.

The reducer (`packages/ui/src/reducer.ts`) is the pure `(state, event) => state` function; `reduceRenderStateAll(events, seed?)` is the fold helper. The 23-variant union exceeds `pipe`'s 20-argument ceiling, so the reducer is a single `Match.tagsExhaustive` map keyed by `_tag` rather than a chain of per-tag `Match.when` calls. Adding a `RunEvent` variant still forces an exhaustiveness compile failure until the new key is handled — `tagsExhaustive` preserves that discipline.

Most variants fold meaningfully (run / module / test lifecycle, coverage, classification). `RunTimedOut` folds into a dedicated `"timed-out"` terminal `phase` on `RenderState` so the renderer shows a final frame instead of hanging. The completeness variants that exist purely so the surface is whole — `ModuleCollected`, `SuiteStarted`, `SuiteFinished`, `HookStarted`, `HookFinished`, `ConsoleLog`, `TestAnnotated`, `TestArtifactRecorded`, `WatcherReady`, `WatcherRerun` — get no-op reducer cases: they pass through `Match` without changing `RenderState`, but are still delivered to every PubSub subscriber and the `onRunEvent` tap, so a future analytics consumer or the MCP dashboard receives them without any plugin change.

The module-lifecycle reducer cases also thread the optional `projectName` from `ModuleQueued` / `ModuleStarted` / `ModuleFinished` onto `ModuleRecord`, which is what lets `StreamApp` group modules by Vitest project.

Two reducer behaviors are load-bearing for `StreamApp`'s state needs. **Timeout routing** — a `TestFinished` carrying `timedOut: true` folds into a separate `timeoutCount` rather than `failCount`, and its `TestRecord.status` becomes the render-only `"timed-out"` value; Vitest reports a timed-out test as `failed`, so the split is a reducer-layer concern (see [../schemas.md](../schemas.md)). **`TrendComputed`** — a `RunEvent` variant the plugin emits after end-of-run trend computation; the reducer folds it into a nullable `trend` field on `RenderState` so `StreamApp` can show a Trend line that the event-sourced run lifecycle does not otherwise carry.

---

## The dispatcher matrix

The T6 rewrite replaced the pre-2.0 mode switch (`renderRun(events, "agent" | "human")`) with a 4 × 3 cell matrix in `packages/ui/src/dispatcher/`. The dispatcher reads the reduced `RenderState` plus a small `RunShape` discriminator and selects one cell:

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

`classifyOutcome(state)` derives the `RunOutcome`. Precedence: `some-fail` (any failures) wins over `threshold-violation`; `all-pass` otherwise. See the classifier tests at `packages/ui/__test__/classify.test.ts` for the corner cases.

### Dispatch entry points

```ts
dispatch(inputs: DispatchInputs, opts: CellOptions): string
dispatchInk(inputs: DispatchInputs, opts: CellOptions): React.ReactElement | null
dispatcherTable                                                    // for test introspection
```

`DispatchInputs` is plain TypeScript (no Effect Schema, no persistence) and lives in `packages/sdk/src/contracts/dispatcher.ts`. It carries `state`, `shape`, `outcome`, the per-project aggregates the workspace cells need (`ProjectSummary[]`), the optional trend summary and below-target file list, plus the resolved `runCommand`. The `buildDispatchInputs` and `resolveCellOptions` helpers that assemble these from a `ReporterRenderInput` and a `ReporterKit` no longer live in this package — they moved to `vitest-agent-reporter` with the default reporter. See [./reporter.md](./reporter.md).

### L1 MCP tool-pointer footer

`packages/ui/src/dispatcher/footer.ts` builds the trailing pointer line(s) that each cell appends. The mapping (UI rewrite spec §3.6):

| Outcome class | Pointer |
| ------------- | ------- |
| all-pass with at least one below-target file | `Use file_coverage to find uncovered functions.` |
| some-fail with `new-failure` or `persistent` classification | `Use test_errors for failure detail; failure_signature_get to check known patterns.` |
| some-fail with `flaky` classification | `Use failure_signature_get to confirm the flakiness signature.` |
| threshold-violation only | `Use test_coverage for the workspace coverage breakdown.` |

`dominantClassification(state)` resolves the dominant failure classification with priority `new-failure → persistent → flaky → recovered → stable`.

### Cell helpers

`packages/ui/src/dispatcher/helpers.ts` holds the shared formatters every cell uses: totals header, failure block, coverage judgment line, trend line, the projects table with name padding and tag-count suffix, the workspace total footer and the below-target table. `packages/ui/src/dispatcher/ink-helpers.tsx` exports `renderAgentStringAsInk`, which wraps an agent string in colored Ink `<Text>` rows so cells can share their agent-half output as a default Ink render.

### Shared duration formatter

`packages/ui/src/format-duration.ts` exports `formatDisplayDuration` — the one display formatter the whole package uses. It rounds sub-second milliseconds to one decimal place and keeps the ≥1s → seconds behavior. `render-agent.ts`, the dispatcher helpers, the `render-ink/` components and `StreamApp` all call it; it replaced three inconsistent inline formatters. It is display-only — full-precision durations still persist to the database unchanged.

---

## The `stream` live component

`packages/ui/src/render-ink/` holds the Ink components for `stream` console mode. The pre-2.0 flat Vitest-shaped renderer (`App.tsx`, `ModuleRow.tsx`) was deleted — a flat per-file list duplicated Vitest's own default reporter.

`StreamApp.tsx` is the agent-shaped, lifecycle-aware top-level component the reporter mounts. It reads the same `RenderState` the reducer produces, classifies the run shape each render via `classifyRunShape`, and lays the state out by run shape — one row per Vitest project (`workspace`), per module (`single-project`), or per test (`single-file` / `single-test`) — rather than as an undifferentiated file list. For the `workspace` shape it groups `state.modules` by `projectName` and reduces each group into a per-project rollup using the existing `ProjectSummary` shape. Because the `forks` pool interleaves modules from different projects with no project-boundary event, each project's running state and rollup are computed continuously from its member modules on every render.

`StreamApp` is not byte-identical to `agent` mode — it is its own renderer, agent-*shaped* but human-tuned (color, animation, no LLM-only affordances). Its layout mirrors the agent view's structure and grows downward: a `Projects (N):` / `Modules (N):` / file-path header, then rows, then (for aggregate shapes) a `Failures (N):` section, then Coverage, Trend and a bottom `Total:` line. There is no top summary line. Sections render only when their slice of `RenderState` exists, so they scale by run shape — `workspace` and `single-project` carry every section, `single-file` always keeps Total and shows Coverage / Trend when the run produced them, `single-test` is a single leaf line and nothing else. The design rationale and per-shape mockups live in `docs/superpowers/specs/2026-05-19-stream-mode-states-design.md`.

`render-ink/` components: `ProjectRow.tsx` is the leaf for the `workspace` shape's per-project rows. `CountColumns.tsx` renders the four fixed glyph count columns — pass `✓`, fail `✗`, skip `↷`, timeout `⧖` — that every aggregate row (project, module) carries, with zero counts dimmed; it is the shared column renderer. `FailuresSection.tsx` is the capped `Failures (N):` block for the aggregate shapes (`workspace`, `single-project`), which cannot expand errors inline; leaf-row shapes expand the error inline under the `✗` row instead. `TrendLine.tsx` is the one-line Trend renderer fed from `RenderState.trend`. `tag-suffix.ts` exports `formatTagSuffix`, the `tag:count` suffix aggregate rows append from `ModuleRecord.tagCounts`. `StatusIcon` carries a `"timed-out"` kind (glyph `⧖`). The pre-2.0 `RunSummary` component was deleted — the StreamApp rework superseded it (its top-summary role became the bottom `Total:` line) and pre-2.0 keeps no dead code. `spinner.ts` is a small helper exposing a hand-rolled Braille frame array — no `ink-spinner` dependency. The spinner frame index and the ticking elapsed column are driven by the animation clock in `vitest-agent-reporter`'s `createLiveInk`, which passes the wall-clock-derived frame index to `StreamApp` as a prop; see [./reporter.md](./reporter.md).

Tall-output handling: a `workspace` frame with a Failures section can exceed a short terminal's height, and Ink cannot redraw in place when that happens. `StreamApp` renders finished `workspace` / `single-project` rows through Ink's `<Static>` region — committed once to scrollback, never redrawn — and keeps only the live tail (running rows, the ticking Total) in the dynamic region, so a tall frame does not stack stale frames in scrollback.

---

## The default reporter no longer lives here

The reporter-package restructure moved `vitest-agent-ui/src/factory/` — the `consoleMode`-branching `VitestAgentReporterFactory` and the live Ink mount driver — into `vitest-agent-reporter/src/`. The `factory/` directory no longer exists in this package, and `packages/ui/src/index.ts` no longer exports `_defaultReporter`, `_createLiveInk`, `buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport` or `renderHumanStringForReport`. The default reporter (now public as `DefaultVitestAgentReporter`), the live mount and the dispatch helpers all live in `vitest-agent-reporter` — see [./reporter.md](./reporter.md). `vitest-agent-ui` is the layer those things are *built from*; it ships only the dispatcher primitives, the reducer, the synthesizers and the PubSub channel.

---

## Package surface

The package entrypoint (`packages/ui/src/index.ts`) re-exports the rendering primitives directly from their source files: the reducer (`reduceRenderState`, `reduceRenderStateAll`), the dispatcher (`dispatch`, `dispatchInk`, `dispatcherTable`, `classifyRunShape`, `classifyOutcome`, `buildFooter`, `dominantClassification`), the agent and Ink render paths, the synthesizers and the PubSub channel. Internal code imports directly from the source file that owns the symbol — there is no barrel beyond the entrypoint.

The pre-2.0 `eventSourcedReporter` factory and the public `createLiveInk` export were deleted in T6 phase 9 along with `render-run.tsx`. A reporter is assembled on top of these primitives in `vitest-agent-reporter` — see `DefaultVitestAgentReporter` for the worked example.

---

## PubSub channel and Effect transport

`packages/ui/src/pubsub/` ships an Effect `PubSub<RunEvent>` channel plus `RunEventChannel` tag and subscriber helpers. After the reporter-package restructure the production wiring *does* use a `PubSub<RunEvent>`: the plugin's `AgentReporter` creates an unbounded `PubSub` per run, threads it onto `ReporterKit.runEvents`, and publishes one event per Vitest streaming callback; `DefaultVitestAgentReporter` subscribes to it for live Ink painting. See [./plugin.md](./plugin.md) and [./reporter.md](./reporter.md) for that flow. The `RunEventChannel` Effect service tag and the `Subscriber.ts` helpers (`accumulateUntilFinished`, `forEachRenderState`, `renderStateStream`) remain for tests, Layer-based wiring and future remote consumers.

---

## Synthesizers

Two converters in `packages/ui/src/synthesize.ts`:

- `synthesizeRunEvents(modules, options?)` — accepts duck-typed `VitestTestModule[]`. Walks modules plus children, builds a `RunStarted → per-module → per-test → RunFinished` sequence. Bridge for any batch context that has the live module shape.
- `synthesizeFromAgentReport(report, options?)` — accepts the persisted `AgentReport`. Only failed modules carry per-test detail; passed-only modules summarize via `summary.passed`. Used by `DefaultVitestAgentReporter.render` (in `vitest-agent-reporter`) and the CLI helpers.

---

## Testing strategy

Four granularities:

1. **Reducer unit tests** (`__test__/reducer.test.ts`).
2. **Classifier tests** (`__test__/classify.test.ts`) — covers run-shape derivation and the some-fail-vs-threshold-violation precedence rule.
3. **Dispatcher cell snapshots** — agent-half snapshots in `__test__/dispatcher/cells.snapshot.test.ts` plus Ink-half snapshots in `__test__/dispatcher/cells.ink.snapshot.test.tsx`. 22 files in `__test__/snapshots/dispatcher/` cover the 12 cells across the relevant fixture event sequences.
4. **Dispatcher and footer tests** — `__test__/dispatch.test.ts`, `__test__/footer.test.ts`. The default-reporter and live-renderer tests moved with `factory/` to `packages/reporter/__test__/`.

Canonical fixtures in `__test__/fixtures/events.ts` are shared across all four granularities; `__test__/fixtures/workspace.ts` carries the `ProjectSummary[]` fixtures the workspace cells need.

---

## Decisions reference

See `../decisions.md` for the recorded design choices:

- D37 — per-executor console matrix.
- D40 — `AgentPluginOptions` is exactly five fields. The T6 rewrite is what made `reporter` a single override hook and `onRunEvent` a stream-tee with no gating.
- D41 — T6 shape-tailored dispatcher matrix and the trade-off against the per-formatter pipeline.

---

## CURRENT_UI_VERSION

`packages/ui/src/index.ts` exports `CURRENT_UI_VERSION` (inlined from `process.env.__PACKAGE_VERSION__` via the package's `rslib.config.ts` `define`). The constant participates in the shared shape test at `packages/sdk/__test__/version-constants-shape.test.ts` (asserts all six runtime `CURRENT_*_VERSION` strings are non-empty and lockstep-equal) and in `packages/ui/__test__/version-constant.test.ts` (asserts it matches `packages/ui/package.json#version`). No init-time drift check compares against `CURRENT_UI_VERSION` because `vitest-agent-ui` is consumed transitively through the plugin and is not a hard peer dependency. See D36 in [../decisions.md](../decisions.md).
