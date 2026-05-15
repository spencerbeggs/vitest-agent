---
status: current
module: vitest-agent-ui
category: architecture
created: 2026-05-12
updated: 2026-05-15
last-synced: 2026-05-15
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

The shared event-sourced renderer that ships the plugin's preassembled default reporter. The T6 UI rewrite collapsed the pre-2.0 per-formatter pipeline plus the dual ingestion paths (`eventSourcedReporter` end-of-run plus `createLiveInk` per-event tap) into one internal stream that lands at a shape-tailored 4 × 3 dispatcher matrix. Users no longer import a reporter or a live-mount factory — the plugin owns both. The package now exposes the dispatcher primitives, the preassembled reporter, the reducer, the synthesizers and the `RunEventChannel` PubSub for hosts building custom reporters on the same stream.

**npm name:** `vitest-agent-ui`
**Location:** `packages/ui/`
**Internal dependencies:** `vitest-agent-sdk`

**Key external dependencies:**

- `react`, `ink` — peer deps for the Ink half of every dispatcher cell
- `effect` — Schema, Match, PubSub, Stream, Layer, Context

---

## Architecture at a glance

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Vitest reporter lifecycle                    │
│  onTestRunStart → onTestModuleQueued → onTestCaseResult → …      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (per-callback synthesizer in AgentReporter)
                       ┌──────────────┐
                       │   RunEvent   │  discriminated union, 11 variants
                       └──────────────┘
                              │
                  forwarded for every consoleMode
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   plugin-internal live Ink mount     user-supplied onRunEvent tap
   (consoleMode === "ink")            (optional, every mode)
              │                               │
              ▼                               ▼
   reducer.event → ink.rerender         user callback
                              │
                              ▼
                       end-of-run batch
                              │
                              ▼
           _defaultReporter (in vitest-agent-ui)
             reduceRenderStateAll(synthesizeFromAgentReport(report))
             classifyRunShape + classifyOutcome
             dispatch(inputs, opts) → string
```

One upstream, one canonical reducer fold, one dispatcher. Live ingestion and end-of-run synthesis land at the same `RenderState` shape; the dispatcher then selects a cell by `(RunShape, RunOutcome)` and renders either an agent string or an Ink tree.

---

## The RunEvent taxonomy and reducer

Schemas live in `packages/sdk/src/schemas/RunEvent.ts` and `packages/sdk/src/schemas/RenderState.ts`, re-exported through `vitest-agent-ui`. The 11 `_tag` variants and the reducer's exhaustive `Match.tag` switch are unchanged from pre-T6; see `packages/ui/src/reducer.ts` for the pure `(state, event) => state` function and `reduceRenderStateAll(events, seed?)` for the fold helper.

Notable per-event behavior is documented in the reducer file. The discipline that adding a `RunEvent` variant forces a `Match.exhaustive` compile failure until handled still applies.

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

`DispatchInputs` is plain TypeScript (no Effect Schema, no persistence) and lives in `packages/sdk/src/contracts/dispatcher.ts`. It carries `state`, `shape`, `outcome`, the per-project aggregates the workspace cells need (`ProjectSummary[]`), the optional trend summary and below-target file list, plus the resolved `runCommand`. See `packages/ui/src/factory/defaultReporter.ts` for `buildDispatchInputs` and `resolveCellOptions` — the helpers that assemble these from a `ReporterRenderInput` and a `ReporterKit`.

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

`packages/ui/src/dispatcher/helpers.ts` holds the shared formatters every cell uses: duration formatting, totals header, failure block, coverage judgment line, trend line, the projects table with name padding and tag-count suffix, the workspace total footer and the below-target table. `packages/ui/src/dispatcher/ink-helpers.tsx` exports `renderAgentStringAsInk`, which wraps an agent string in colored Ink `<Text>` rows so cells can share their agent-half output as a default Ink render.

---

## The preassembled default reporter

`packages/ui/src/factory/defaultReporter.ts` exports `_defaultReporter` — a `VitestAgentReporterFactory` from `vitest-agent-sdk`. The plugin imports it as its built-in; users never name it directly. The leading underscore marks it as plugin-internal even though it lives in the package's `export *` surface.

`render(input)` branches on `kit.config.consoleMode`:

- `agent` — folds `input.reports` through `synthesizeFromAgentReport` and the reducer, builds `DispatchInputs`, calls `dispatch(inputs, opts)`, returns one `RenderedOutput` with `target: "stdout"` carrying the dispatched string.
- `silent`, `passthrough`, `ink`, `ci-annotations` — emits no stdout `RenderedOutput`. For `ink`, the plugin's internal live mount paints per-event during the run.
- For every mode, when `kit.config.githubActions` is `true`, the factory emits an additional `RenderedOutput` with `target: "github-summary"` carrying a GFM-flavored payload. This preserves the pre-2.0 GitHub Step Summary behavior independent of the console mode.

Companion helpers exported alongside the factory:

- `buildDispatchInputs(state, input, overrides?)` — assemble `DispatchInputs` from a reduced state plus a `ReporterRenderInput`. Lifts per-project summaries, the below-target file list and the trend summary into the dispatcher's plain-TypeScript shape.
- `resolveCellOptions(kit)` — derive `CellOptions` (width, `noColor`, `coverageConsoleLimit`, etc.) from the `ReporterKit`.
- `renderAgentStringForReport(report)` — synchronous helper used by the CLI's `show` command for an agent-string single-report render.
- `renderHumanStringForReport(report, options?)` — async helper that dynamic-imports `ink` and returns a stripped-string render of the dispatcher's Ink half. Used by `vitest-agent show --format human`.

---

## Live-mount lifecycle (internal `_createLiveInk`)

`packages/ui/src/factory/LiveInkRenderer.tsx`. The live Ink mount is now plugin-internal. Exported from `factory/index.ts` as `_createLiveInk` so the plugin can wire it; consumers do not see it.

```ts
interface LiveInkRenderer {
  event(e: RunEvent): void;
  unmount(): void;
  snapshot(): RenderState;
}
```

Behavior:

- `RunStarted` (or any event that flips `state.phase` from `idle`) triggers `ink.render(<App state />)`.
- Subsequent events run the reducer, then `instance.rerender(<App state />)`. The Ink tree uses the same dispatcher cells via their `ink` half.
- `RunFinished` schedules `instance.unmount()` on the next tick so the terminal commits the final frame before alt-screen teardown.
- Mount and rerender failures are caught and logged to stderr; `snapshot()` still advances.

The plugin instantiates the live mount itself when the resolved `consoleMode === "ink"`. The user-supplied `onRunEvent` tap (see `plugin.md`) is now forwarded for every mode and is a read-only tee — it does not gate the live mount.

---

## Factory surface

`packages/ui/src/factory/index.ts` exports:

- `_defaultReporter` — the preassembled default reporter (above).
- `buildDispatchInputs`, `resolveCellOptions` — helpers re-exported for custom reporters built on the same dispatcher.
- `renderAgentStringForReport`, `renderHumanStringForReport` — CLI helpers.
- `_createLiveInk` (alias of `createLiveInk`), `CreateLiveInkOptions`, `LiveInkRenderer` — plugin-internal live mount.

The pre-2.0 `eventSourcedReporter` factory and the public `createLiveInk` export were deleted in T6 phase 9 along with `render-run.tsx`. Hosts that need their own reporter implement `VitestAgentReporterFactory` directly and consume the dispatcher primitives from this package; see `packages/reporter/` for the convenience re-export package.

---

## PubSub channel and Effect transport

`packages/ui/src/pubsub/` ships an Effect `PubSub<RunEvent>` channel for hosts that want multi-subscriber fan-out or Layer-based wiring. The production wiring does not use the channel — the plugin forwards events directly to the live mount and to the user-supplied `onRunEvent` tap — but the channel exists for tests, future remote consumers and Effect-fluent hosts. See `packages/ui/src/pubsub/Channel.ts` for the tag and live layer; `Subscriber.ts` exposes `accumulateUntilFinished`, `forEachRenderState` and `renderStateStream`.

---

## Synthesizers

Two converters in `packages/ui/src/synthesize.ts`:

- `synthesizeRunEvents(modules, options?)` — accepts duck-typed `VitestTestModule[]`. Walks modules plus children, builds a `RunStarted → per-module → per-test → RunFinished` sequence. Bridge for any batch context that has the live module shape.
- `synthesizeFromAgentReport(report, options?)` — accepts the persisted `AgentReport`. Only failed modules carry per-test detail; passed-only modules summarize via `summary.passed`. Used by `_defaultReporter.render` and the CLI helpers.

---

## Testing strategy

Four granularities:

1. **Reducer unit tests** (`__test__/reducer.test.ts`).
2. **Classifier tests** (`__test__/classify.test.ts`) — covers run-shape derivation and the some-fail-vs-threshold-violation precedence rule.
3. **Dispatcher cell snapshots** — agent-half snapshots in `__test__/dispatcher/cells.snapshot.test.ts` plus Ink-half snapshots in `__test__/dispatcher/cells.ink.snapshot.test.tsx`. 22 files in `__test__/snapshots/dispatcher/` cover the 12 cells across the relevant fixture event sequences.
4. **Factory and footer tests** — `__test__/default-reporter.test.ts`, `__test__/dispatch.test.ts`, `__test__/footer.test.ts`.

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
