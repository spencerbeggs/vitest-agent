# vitest-agent-ui

The pure rendering-primitives library for `vitest-agent`. Owns the `RunEvent`
taxonomy re-export, the pure reducer, two render paths (a markdown-flavored
agent string and a React Ink tree), the shape-tailored dispatcher matrix
introduced by the T6 rewrite, an Effect `PubSub` channel for live event
transport, and the synthesizers. Knows nothing about the reporter
lifecycle — the default reporter and the Ink live-mount driver moved to
`vitest-agent-reporter`. Declares React and Ink as peer dependencies (it
renders *with* react/ink but does not own the instance); `vitest-agent-reporter`
is the concrete consumer that provides them. Dependency flow: `plugin → reporter → ui → sdk`.

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
    StreamApp.tsx, StatusIcon.tsx, ModuleHeader.tsx, TestRow.tsx,
    ProjectRow.tsx, CountColumns.tsx, CoverageBlock.tsx, TrendLine.tsx,
    FailureSection.tsx, FailuresSection.tsx, SuggestedActions.tsx,
    spinner.ts, tag-suffix.ts, format-duration.ts
  pubsub/                       -- Effect PubSub channel
    Channel.ts                  -- RunEventChannel tag + Live layer
    Publisher.ts                -- publish / publishAll helpers
    Subscriber.ts               -- accumulateUntilFinished,
                                   forEachRenderState, renderStateStream

__test__/
  reducer.test.ts                                 -- event-by-event coverage
  render-agent.test.ts + golden.test.ts           -- inline + file snapshots
  classify.test.ts                                -- dispatcher run-shape + outcome
  dispatch.test.ts                                -- dispatcher cell routing
  footer.test.ts                                  -- footer assembly
  dispatcher/                                     -- per-cell tests
  render-ink/*.test.tsx                           -- per-component frames
  pubsub.test.ts                                  -- roundtrip + fan-out
  synthesize*.test.ts                             -- both synthesizer paths
  fixtures/events.ts                              -- canonical event sequences
  snapshots/                                      -- file-based goldens
  utils/render-ink.tsx                            -- stripAnsi + renderInk helper
```

## Key files

| File | Purpose |
| ---- | ------- |
| `reducer.ts` | Exhaustive `Match.tagsExhaustive` switch over the `RunEvent` discriminated union. Pure synchronous projection. `reduceRenderStateAll` folds a full sequence for the one-shot path |
| `render-agent.ts` | Token-economy markdown-flavored final-frame string. Stable for stable inputs (no timestamps in body). Width-aware diff truncation, top-N gap caps. Still used as a primitive inside dispatcher cells |
| `synthesize.ts` | Two bridges into the event taxonomy: `synthesizeRunEvents` reads live Vitest module data, `synthesizeFromAgentReport` reads the persisted SDK schema |
| `dispatcher/classify.ts` | `classifyRunShape(state, projects)` returns one of `single-test`, `single-file`, `single-project`, `workspace`; `classifyOutcome(state)` returns `all-pass`, `some-fail`, `threshold-violation`. Pure |
| `dispatcher/dispatch.ts` | `dispatcherTable` is the 4 x 3 cell matrix; `dispatch(inputs, opts)` produces the agent string; `dispatchInk(inputs, opts)` returns the Ink element for live and report-time Ink frames |
| `dispatcher/footer.ts` | `buildFooter` assembles the L1 MCP-tool-pointer footer; `dominantClassification` picks the most actionable failure class to point at |
| `dispatcher/helpers.ts` + `ink-helpers.tsx` | Shared formatting primitives used by every cell so cells stay focused on shape-specific copy |
| `dispatcher/cells/*` | Twelve cells, one per `(shape, outcome)` pair. Each exports an agent-string renderer and an Ink-half renderer |
| `pubsub/Channel.ts` | `RunEventChannel` Effect tag plus the scoped `RunEventChannelLive` layer providing `PubSub.unbounded<RunEvent>` |
| `pubsub/Subscriber.ts` | `accumulateUntilFinished` (one-shot agent path), `forEachRenderState` (live callback driving), `renderStateStream` (Stream composition entry) |

## Conventions

- **Effect-fluent**: every transport-level abstraction lives in `effect`'s vocabulary (Schema, PubSub, Layer). The reducer itself is synchronous because it has to be cheap to call from React; everything upstream (publisher, subscriber, channel) is Effect-typed.
- **Shape-tailored cells**: the dispatcher routes by `(RunShape, RunOutcome)`. Cells receive a fully-built `DispatchInputs` plus `CellOptions` from the SDK contract and never re-derive shape, outcome, project aggregates, trend, or below-target listings. Pre-compute in `buildDispatchInputs`, not inside cells.
- **Two synthesizers**: one for live Vitest data (`VitestTestModule` duck types), one for the persisted `AgentReport`. They are NOT interchangeable — the live shape carries per-test detail the report schema flattens. CLI replay uses the report path; the plugin's streaming callbacks publish events derived from live modules.
- **Ink component primitives only.** No `<span style>` or DOM-isms. Use Ink's `<Box>`, `<Text>`, `<Newline>`, `<Spacer>`. Each component imports `* as React from "react"` so JSX works under both the classic and automatic compiler runtimes — relevant whenever a non-ui package compiles these via esbuild.
- **Snapshot pinning**: per-component snapshots use the helper `__test__/utils/render-ink.tsx` which strips ANSI and pins the width via `<Box width={N}>`. `ink-testing-library` reports a fixed 100-column mock stdout, so explicit width wrapping is load-bearing.
- **No reporter lifecycle here.** This package is pure rendering primitives. The default reporter (`DefaultVitestAgentReporter`) and the Ink live-mount driver (`_createLiveInk`) live in `vitest-agent-reporter`. Adding a shipped reporter or factory means editing `vitest-agent-reporter`, not this package.

## When working in this package

- **Adding a `RunEvent` variant**: extend the schema in `packages/sdk/src/schemas/RunEvent.ts`, then add a tag handler in the `Match.tagsExhaustive` block in `reducer.ts`. `Match.tagsExhaustive` fails compilation in `reducer.ts` until the new variant is handled. Update both synthesizers (`synthesize.ts`) if the new event can be derived from either source.
- **Touching the reducer**: the function must stay pure. No I/O, no time, no randomness. Tests in `reducer.test.ts` verify every event type independently plus the four canonical fixture folds.
- **Touching `render-agent.ts`**: byte-identical output for byte-identical input. Snapshots in `__test__/snapshots/render-agent/` capture each canonical fixture's expected frame.
- **Adding or editing a dispatcher cell**: cells live under `dispatcher/cells/` named `<shape>-<outcome>.ts`. Each exports both an agent-string renderer and an Ink-half renderer; both consume the shared helpers in `dispatcher/helpers.ts` / `ink-helpers.tsx`. The cell receives `DispatchInputs` plus `CellOptions` — do not reach for the kit or env directly.
- **Adding an Ink component**: write a `.tsx` file in `render-ink/`, re-export from `render-ink/index.ts`, and add a snapshot test in `__test__/render-ink/`. Use `renderInk(tree, width)` from the test utils to pin the output width.
- **`StreamApp` is the human-tuned `stream` renderer**: it mirrors the agent view's structure but is a parallel renderer, not the dispatcher. Its layout is a `Projects (N):` / `Modules (N):` / file-path header, count-column rows, a `FailuresSection`, then Coverage / Trend / Total. Aggregate rows render the four `✓ ✗ ↷ ⧖` glyph columns via the shared `CountColumns` component (zeros dimmed); leaf rows show one `StatusIcon`. `StatusIcon` carries a `"timed-out"` kind. The spinner frame index and `nowMs` arrive as props — never `RenderState`. See `2026-05-19-stream-mode-states-design.md`.
- **Timed-out tests are a render-layer outcome**: the reducer routes a `timedOut` `TestFinished` into `RenderState`'s `timeoutCount` (not `failCount`) and sets the `TestRecord` status to `"timed-out"`. The `TrendComputed` `RunEvent` folds `direction` / `runCount` into `RenderState.trend`, which `TrendLine` renders. There is no SQLite change — the persistence `TestState` enum is unchanged.
- **Changing the dispatcher contract**: the contract types (`RunShape`, `RunOutcome`, `ProjectSummary`, `TrendSummary`, `DispatchInputs`, `CellOptions`) live in `packages/sdk/src/contracts/dispatcher.ts`. Coordinate changes there before editing cells.
- **Changing the reporter contract**: every reporter factory extends the same `VitestAgentReporterFactory` contract from `packages/sdk/src/contracts/reporter.ts`. Coordinate changes there.
- **Adding fields to `kit.config`**: the new field lives in `ResolvedReporterConfig` (`packages/sdk/src/contracts/reporter.ts`) and is populated by `buildReporterKit` in the plugin (`packages/plugin/src/utils/build-reporter-kit.ts`). Factories destructure only what they consume.

## Design references

- `@.claude/design/vitest-agent/components/ui.md`
  Load when working on the event taxonomy, the reducer, the dispatcher matrix, the cells, or the render paths.
- `@.claude/design/vitest-agent/components/reporter.md`
  Load when working on `DefaultVitestAgentReporter` or the Ink live-mount lifecycle — both moved to `vitest-agent-reporter`.
- `@.claude/design/vitest-agent/schemas.md`
  Load when adding to the `RunEvent` or `RenderState` schemas.
- `@.claude/design/vitest-agent/decisions.md`
  Load for rationale on D41 (T6 shape-tailored dispatcher matrix) and the plugin / reporter / ui layering.
