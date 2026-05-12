# vitest-agent-ui

The shared event-sourced renderer for `vitest-agent`. Owns the
`RunEvent` taxonomy re-export, the pure reducer, two terminal
renderers (a markdown-flavored agent string and a React Ink tree), an
Effect `PubSub` channel for live event transport, a synchronous
one-shot helper, a `VitestAgentReporterFactory` implementation, and a
live-mount Ink driver. Ships React and Ink as peer dependencies; the
plugin and CLI consume it.

## Layout

```text
src/
  index.ts                      -- public re-exports
  reducer.ts                    -- pure (state, event) => state
  render-agent.ts               -- renderAgent(state, opts): string
  render-run.tsx                -- renderRun(events, mode, opts): string
  synthesize.ts                 -- synthesizeRunEvents (live modules)
                                   + synthesizeFromAgentReport (DB replay)
  render-ink/                   -- Ink components
    App.tsx                     -- root composition
    StatusIcon.tsx              -- single-character glyph
    RunSummary.tsx              -- header line
    ModuleHeader.tsx            -- module title + counts
    TestRow.tsx, ModuleRow.tsx  -- per-test / per-module rows
    CoverageBlock.tsx           -- per-metric block
    FailureSection.tsx          -- failure list
    SuggestedActions.tsx        -- severity-prefixed action list
  pubsub/                       -- Effect PubSub channel
    Channel.ts                  -- RunEventChannel tag + Live layer
    Publisher.ts                -- publish / publishAll helpers
    Subscriber.ts               -- accumulateUntilFinished,
                                   forEachRenderState, renderStateStream
  factory/                      -- reporter factories
    EventSourcedReporterFactory.ts  -- VitestAgentReporterFactory
    LiveInkRenderer.tsx             -- createLiveInk imperative mount

__test__/
  reducer.test.ts                                 -- event-by-event coverage
  render-agent.test.ts + golden.test.ts           -- inline + file snapshots
  render-ink/*.test.tsx                           -- per-component frames
  pubsub.test.ts                                  -- roundtrip + fan-out
  synthesize*.test.ts                             -- both synthesizer paths
  render-run.test.tsx                             -- agent / human parity
  event-sourced-reporter.test.ts                  -- factory dispatch
  live-ink-renderer.test.ts                       -- mount orchestration
  fixtures/events.ts                              -- canonical event sequences
  snapshots/                                      -- file-based goldens
  utils/render-ink.tsx                            -- stripAnsi + renderInk helper
```

## Key files

| File | Purpose |
| ---- | ------- |
| `reducer.ts` | Exhaustive `Match.tag` switch over the `RunEvent` discriminated union. Pure synchronous projection. `reduceRenderStateAll` folds a full sequence for the one-shot path |
| `render-agent.ts` | Token-economy markdown-flavored final-frame string. Stable for stable inputs (no timestamps in body). Width-aware diff truncation, top-N gap caps |
| `render-run.tsx` | Synchronous host entry point. `renderRun(events, mode, opts): string` dispatches between `renderAgent` and Ink `renderToString` |
| `synthesize.ts` | Two bridges into the event taxonomy: `synthesizeRunEvents` reads live Vitest module data, `synthesizeFromAgentReport` reads the persisted SDK schema |
| `render-ink/App.tsx` | Root composition. Sections rendered conditionally on state slices |
| `pubsub/Channel.ts` | `RunEventChannel` Effect tag plus the scoped `RunEventChannelLive` layer providing `PubSub.unbounded<RunEvent>` |
| `pubsub/Subscriber.ts` | `accumulateUntilFinished` (one-shot agent path), `forEachRenderState` (live callback driving), `renderStateStream` (Stream composition entry) |
| `factory/EventSourcedReporterFactory.ts` | `eventSourcedReporter` `VitestAgentReporterFactory` that dispatches on `kit.config.consoleMode`. Emits the agent string for `agent` mode; emits nothing for `ink`, `ci-annotations`, `silent`, `passthrough` (other channels own the visible work) |
| `factory/LiveInkRenderer.tsx` | `createLiveInk` imperative orchestration. `event(e)` advances state and rerenders the mounted Ink tree, `unmount()` is idempotent, `snapshot()` exposes the latest reduced state. Mount failures degrade silently with a stderr warning |

## Conventions

- **Effect-fluent**: every transport-level abstraction lives in
  `effect`'s vocabulary (Schema, PubSub, Layer). The reducer itself is
  synchronous because it has to be cheap to call from React; everything
  upstream (publisher, subscriber, channel) is Effect-typed.
- **Two synthesizers**: one for live Vitest data (`VitestTestModule`
  duck types), one for the persisted `AgentReport`. They are NOT
  interchangeable — the live shape carries per-test detail the report
  schema flattens. CLI replay uses the report path; the plugin's
  streaming callbacks publish events derived from live modules.
- **Ink component primitives only.** No `<span style>` or DOM-isms.
  Use Ink's `<Box>`, `<Text>`, `<Newline>`, `<Spacer>`. Each component
  imports `* as React from "react"` so JSX works under both the
  classic and automatic compiler runtimes — relevant whenever a
  non-ui package compiles these via esbuild.
- **Snapshot pinning**: per-component snapshots use the helper
  `__test__/utils/render-ink.tsx` which strips ANSI and pins the
  width via `<Box width={N}>`. `ink-testing-library` reports a fixed
  100-column mock stdout, so explicit width wrapping is load-bearing.
- **Factory contract**: `eventSourcedReporter` is a
  `VitestAgentReporterFactory`. The plugin calls it once with the
  resolved kit; the factory returns one reporter object whose
  `render(input)` is called once at end-of-run with all reports.
  Live rendering happens via a separate channel: the plugin's
  `onRunEvent` tap (typically `createLiveInk()`).
- **Live render gating**: the plugin only forwards `onRunEvent` to the
  reporter when the resolved `consoleMode` is `ink`. Other modes
  suppress the tap so an Ink mount does not leak into `silent`,
  `passthrough`, or `agent` mode. See `packages/plugin/src/plugin.ts`.

## When working in this package

- **Adding a `RunEvent` variant**: extend the schema in
  `packages/sdk/src/schemas/RunEvent.ts`, then add a `Match.tag`
  handler in `reducer.ts`. The exhaustive `Match.exhaustive` terminator
  will fail compilation in `reducer.ts` until the new variant is
  handled. Update both synthesizers (`synthesize.ts`) if the new event
  can be derived from either source.
- **Touching the reducer**: the function must stay pure. No I/O, no
  time, no randomness. Tests in `reducer.test.ts` verify every event
  type independently plus the four canonical fixture folds.
- **Touching `render-agent.ts`**: byte-identical output for byte-
  identical input. Snapshots in `__test__/snapshots/render-agent/`
  capture each canonical fixture's expected frame. The agent-output
  format is currently under revision — see "Known divergence" below.
- **Adding an Ink component**: write a `.tsx` file in `render-ink/`,
  re-export from `render-ink/index.ts`, and add a snapshot test in
  `__test__/render-ink/`. Use `renderInk(tree, width)` from the test
  utils to pin the output width.
- **Changing the factory contract**: every named factory in
  `packages/reporter/` extends the same `VitestAgentReporterFactory`
  contract from `vitest-agent-sdk`. Coordinate changes there.
- **Adding fields to `kit.config`**: the new field lives in
  `ResolvedReporterConfig` (`packages/sdk/src/contracts/reporter.ts`)
  and is populated by `buildReporterKit` in the plugin
  (`packages/plugin/src/utils/build-reporter-kit.ts`). Factories
  destructure only what they consume.

## Known divergence from main's agent output

The `eventSourcedReporter` ships per-project frames — one
`RenderedOutput` per `AgentReport` in `input.reports`. In a six-project
workspace this produces six separate `Tests: …` blocks plus six
`Coverage:` blocks.

The pre-2.0 main branch produced a single workspace-aggregate frame:
one compact `Projects (N):` table with `int:X unit:Y` test-kind
breakdown per project, one coverage line, a `Trend: …` line, and a
single `Files below aspirational target:` table.

Restoring the aggregate is a focused design effort tracked at
`docs/superpowers/specs/agent-output-format-restoration.md`. The data
the renderer needs already lives in `AgentReport.tagCounts` (test-kind
breakdown) and the trend summary that flows through
`ReporterRenderInput.trendSummary`; the new renderer does not consume
them yet. Until that spec lands, the per-project agent frames are the
shipped behavior.

## Design references

- `@./.claude/design/vitest-agent/components/ui.md`
  Load when working on the event taxonomy, the reducer, the two
  renderers, or the live-mount lifecycle.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding to the `RunEvent` or `RenderState` schemas.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for rationale on the per-executor console matrix and the
  factory-vs-tap split for live rendering.
- `@./docs/superpowers/specs/vitest-agent-ui.md`
  The original spec. Captures motivation and open questions; the
  format-regression note above is the open work that didn't land here.
- `@./docs/superpowers/specs/agent-output-format-restoration.md`
  The follow-on spec for restoring the workspace-aggregate output.
