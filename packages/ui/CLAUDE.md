# vitest-agent-ui

The shared event-sourced renderer for `vitest-agent`. Owns the `RunEvent`
taxonomy re-export, the pure reducer, two render paths (a markdown-flavored
agent string and a React Ink tree), the shape-tailored dispatcher matrix
introduced by the T6 rewrite, the preassembled default reporter
(`_defaultReporter`), an Effect `PubSub` channel for live event transport,
the synthesizers, and the internal `_createLiveInk` driver. Ships React
and Ink as peer dependencies; the plugin consumes the default reporter
and the live-Ink mount, the CLI consumes the report-time render helpers.

## Layout

```text
src/
  index.ts                      -- public re-exports
  reducer.ts                    -- pure (state, event) => state
  render-agent.ts               -- renderAgent(state, opts): string
  synthesize.ts                 -- synthesizeRunEvents (live modules)
                                   + synthesizeFromAgentReport (DB replay)
  dispatcher/                   -- T6 shape-tailored renderer matrix
    classify.ts                 -- classifyRunShape, classifyOutcome
    dispatch.ts                 -- dispatcherTable, dispatch, dispatchInk
    footer.ts                   -- buildFooter + dominantClassification
                                   (L1 MCP tool pointer footers)
    helpers.ts                  -- shared agent-string formatters used by cells
    ink-helpers.tsx             -- shared Ink primitives used by cells
    cell-types.ts               -- Cell + AgentCellFn contracts
    cells/                      -- 12 cells, one per (shape, outcome) pair
      single-test-pass.ts, single-test-fail.ts, single-test-threshold.ts,
      single-file-pass.ts, single-file-fail.ts, single-file-threshold.ts,
      single-project-pass.ts, single-project-fail.ts,
      single-project-threshold.ts, workspace-pass.ts, workspace-fail.ts,
      workspace-threshold.ts
  render-ink/                   -- Ink components (live mount + ink-half cells)
    App.tsx, StatusIcon.tsx, RunSummary.tsx, ModuleHeader.tsx,
    TestRow.tsx, ModuleRow.tsx, CoverageBlock.tsx, FailureSection.tsx,
    SuggestedActions.tsx
  pubsub/                       -- Effect PubSub channel
    Channel.ts                  -- RunEventChannel tag + Live layer
    Publisher.ts                -- publish / publishAll helpers
    Subscriber.ts               -- accumulateUntilFinished,
                                   forEachRenderState, renderStateStream
  factory/                      -- reporter factories
    defaultReporter.ts          -- _defaultReporter (preassembled default)
                                   + buildDispatchInputs, resolveCellOptions,
                                   renderAgentStringForReport,
                                   renderHumanStringForReport
    LiveInkRenderer.tsx         -- _createLiveInk imperative mount (internal)

__test__/
  reducer.test.ts                                 -- event-by-event coverage
  render-agent.test.ts + golden.test.ts           -- inline + file snapshots
  classify.test.ts                                -- dispatcher run-shape + outcome
  dispatch.test.ts                                -- dispatcher cell routing
  footer.test.ts                                  -- footer assembly
  default-reporter.test.ts                        -- _defaultReporter end-to-end
  dispatcher/                                     -- per-cell tests
  render-ink/*.test.tsx                           -- per-component frames
  pubsub.test.ts                                  -- roundtrip + fan-out
  synthesize*.test.ts                             -- both synthesizer paths
  live-ink-renderer.test.ts                       -- mount orchestration
  fixtures/events.ts                              -- canonical event sequences
  snapshots/                                      -- file-based goldens
  utils/render-ink.tsx                            -- stripAnsi + renderInk helper
```

## Key files

| File | Purpose |
| ---- | ------- |
| `reducer.ts` | Exhaustive `Match.tag` switch over the `RunEvent` discriminated union. Pure synchronous projection. `reduceRenderStateAll` folds a full sequence for the one-shot path |
| `render-agent.ts` | Token-economy markdown-flavored final-frame string. Stable for stable inputs (no timestamps in body). Width-aware diff truncation, top-N gap caps. Still used as a primitive inside dispatcher cells |
| `synthesize.ts` | Two bridges into the event taxonomy: `synthesizeRunEvents` reads live Vitest module data, `synthesizeFromAgentReport` reads the persisted SDK schema |
| `dispatcher/classify.ts` | `classifyRunShape(state, projects)` returns one of `single-test`, `single-file`, `single-project`, `workspace`; `classifyOutcome(state)` returns `all-pass`, `some-fail`, `threshold-violation`. Pure |
| `dispatcher/dispatch.ts` | `dispatcherTable` is the 4 x 3 cell matrix; `dispatch(inputs, opts)` produces the agent string; `dispatchInk(inputs, opts)` returns the Ink element for live and report-time Ink frames |
| `dispatcher/footer.ts` | `buildFooter` assembles the L1 MCP-tool-pointer footer; `dominantClassification` picks the most actionable failure class to point at |
| `dispatcher/helpers.ts` + `ink-helpers.tsx` | Shared formatting primitives used by every cell so cells stay focused on shape-specific copy |
| `dispatcher/cells/*` | Twelve cells, one per `(shape, outcome)` pair. Each exports an agent-string renderer and an Ink-half renderer |
| `pubsub/Channel.ts` | `RunEventChannel` Effect tag plus the scoped `RunEventChannelLive` layer providing `PubSub.unbounded<RunEvent>` |
| `pubsub/Subscriber.ts` | `accumulateUntilFinished` (one-shot agent path), `forEachRenderState` (live callback driving), `renderStateStream` (Stream composition entry) |
| `factory/defaultReporter.ts` | `_defaultReporter` `VitestAgentReporterFactory` that the plugin wires by default. Folds the published event stream into `RenderState`, classifies, dispatches, and emits one `RenderedOutput` for the run. Branches on `kit.config.consoleMode`: emits the agent string for `agent`; emits nothing for `silent`, `passthrough`, `ci-annotations`, or `ink` (live Ink owns visible work in `ink` mode). Also exposes `buildDispatchInputs` and `resolveCellOptions` (used by the reporter package's escape-hatch SDK and the CLI's `show` command) plus `renderAgentStringForReport` and `renderHumanStringForReport` (used by the CLI) |
| `factory/LiveInkRenderer.tsx` | `_createLiveInk` imperative orchestration (internal). The plugin mounts this when `consoleMode === "ink"`; `event(e)` advances state and rerenders, `unmount()` is idempotent, `snapshot()` exposes the latest reduced state. Mount failures degrade silently with a stderr warning |

## Conventions

- **Effect-fluent**: every transport-level abstraction lives in `effect`'s vocabulary (Schema, PubSub, Layer). The reducer itself is synchronous because it has to be cheap to call from React; everything upstream (publisher, subscriber, channel) is Effect-typed.
- **Shape-tailored cells**: the dispatcher routes by `(RunShape, RunOutcome)`. Cells receive a fully-built `DispatchInputs` plus `CellOptions` from the SDK contract and never re-derive shape, outcome, project aggregates, trend, or below-target listings. Pre-compute in `buildDispatchInputs`, not inside cells.
- **Two synthesizers**: one for live Vitest data (`VitestTestModule` duck types), one for the persisted `AgentReport`. They are NOT interchangeable — the live shape carries per-test detail the report schema flattens. CLI replay uses the report path; the plugin's streaming callbacks publish events derived from live modules.
- **Ink component primitives only.** No `<span style>` or DOM-isms. Use Ink's `<Box>`, `<Text>`, `<Newline>`, `<Spacer>`. Each component imports `* as React from "react"` so JSX works under both the classic and automatic compiler runtimes — relevant whenever a non-ui package compiles these via esbuild.
- **Snapshot pinning**: per-component snapshots use the helper `__test__/utils/render-ink.tsx` which strips ANSI and pins the width via `<Box width={N}>`. `ink-testing-library` reports a fixed 100-column mock stdout, so explicit width wrapping is load-bearing.
- **Factory contract**: `_defaultReporter` is a `VitestAgentReporterFactory`. The plugin calls it once with the resolved kit; the factory returns one reporter object whose `render(input)` is called once at end-of-run with all reports. Live rendering happens via the internal `_createLiveInk` mount the plugin starts when `consoleMode === "ink"`.
- **Internal live mount**: `_createLiveInk` is prefixed with `_` because it is not user wiring in 2.0. Users do not pass `onRunEvent: createLiveInk().event` anymore — the plugin owns the mount and forwards the user's `onRunEvent` callback unconditionally as a tee on the same stream.

## When working in this package

- **Adding a `RunEvent` variant**: extend the schema in `packages/sdk/src/schemas/RunEvent.ts`, then add a `Match.tag` handler in `reducer.ts`. The exhaustive `Match.exhaustive` terminator will fail compilation in `reducer.ts` until the new variant is handled. Update both synthesizers (`synthesize.ts`) if the new event can be derived from either source.
- **Touching the reducer**: the function must stay pure. No I/O, no time, no randomness. Tests in `reducer.test.ts` verify every event type independently plus the four canonical fixture folds.
- **Touching `render-agent.ts`**: byte-identical output for byte-identical input. Snapshots in `__test__/snapshots/render-agent/` capture each canonical fixture's expected frame.
- **Adding or editing a dispatcher cell**: cells live under `dispatcher/cells/` named `<shape>-<outcome>.ts`. Each exports both an agent-string renderer and an Ink-half renderer; both consume the shared helpers in `dispatcher/helpers.ts` / `ink-helpers.tsx`. The cell receives `DispatchInputs` plus `CellOptions` — do not reach for the kit or env directly.
- **Adding an Ink component**: write a `.tsx` file in `render-ink/`, re-export from `render-ink/index.ts`, and add a snapshot test in `__test__/render-ink/`. Use `renderInk(tree, width)` from the test utils to pin the output width.
- **Changing the dispatcher contract**: the contract types (`RunShape`, `RunOutcome`, `ProjectSummary`, `TrendSummary`, `DispatchInputs`, `CellOptions`) live in `packages/sdk/src/contracts/dispatcher.ts`. Coordinate changes there before editing cells.
- **Changing the reporter contract**: every reporter factory extends the same `VitestAgentReporterFactory` contract from `packages/sdk/src/contracts/reporter.ts`. Coordinate changes there.
- **Adding fields to `kit.config`**: the new field lives in `ResolvedReporterConfig` (`packages/sdk/src/contracts/reporter.ts`) and is populated by `buildReporterKit` in the plugin (`packages/plugin/src/utils/build-reporter-kit.ts`). Factories destructure only what they consume.

## Design references

- `@./.claude/design/vitest-agent/components/ui.md`
  Load when working on the event taxonomy, the reducer, the dispatcher matrix, the cells, the render paths, the preassembled default reporter, or the live-mount lifecycle.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding to the `RunEvent` or `RenderState` schemas.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale on D41 (T6 shape-tailored dispatcher matrix), and on D33 / D34 / D37 amendments covering the preassembled default reporter, the internal live-Ink mount, and the plugin owning consoleMode dispatch.
