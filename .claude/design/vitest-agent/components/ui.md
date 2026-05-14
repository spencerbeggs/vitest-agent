---
status: current
module: vitest-agent-ui
category: architecture
created: 2026-05-12
updated: 2026-05-14
last-synced: 2026-05-14
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

The shared event-sourced renderer for vitest-agent's terminal output.
Replaces the pre-2.0 per-formatter pipeline with a single event taxonomy
flowing through a pure reducer into two surface-specific renderers: a
markdown-flavored agent string and a React Ink tree. Adds a live-mount
driver for the Ink path so humans see test progress animate rather than
landing as a single batched dump at end of run.

**npm name:** `vitest-agent-ui`
**Location:** `packages/ui/`
**Internal dependencies:** `vitest-agent-sdk`

**Key external dependencies:**

- `react`, `ink` — peer deps for the Ink component tree
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
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
   onRunEvent tap                          renderInput.reports
   (live, per-event)                       (end-of-run, batch)
        │                                           │
        ▼                                           ▼
  ┌────────────┐                            ┌────────────────┐
  │ createLive │                            │ synthesizeFrom │
  │   Ink()    │                            │  AgentReport() │
  └────────────┘                            └────────────────┘
        │                                           │
        ▼                                           ▼
   reducer.event                              reducer.fold
        │                                           │
        ▼                                           ▼
   ink.rerender                              renderAgent(state)
   (long-running)                            → RenderedOutput
```

Two consumption paths feed off the same reducer:

1. **Live tap** — the plugin's `AgentReporter` constructs a `RunEvent`
   from each Vitest streaming callback and forwards it to a user-
   supplied `onRunEvent` callback. `createLiveInk()` is the canonical
   consumer: it reduces incoming events into accumulated state and
   re-mounts the Ink tree on each beat. Drives the human-mode animation.

2. **Batch synthesis** — `eventSourcedReporter` runs at end-of-run via
   the standard `VitestAgentReporterFactory.render(input)` contract.
   For each `AgentReport` in `input.reports`, it calls
   `synthesizeFromAgentReport` to produce an event sequence, folds it
   through the reducer, and renders one `RenderedOutput` via the agent
   string renderer. Drives the agent-mode static frame.

These paths are independent — either can be active alone, both can be
active simultaneously, or both can be disabled.

---

## The RunEvent taxonomy

Defined in `packages/sdk/src/schemas/RunEvent.ts`, re-exported through
`vitest-agent-ui`. 11 tagged variants:

| Tag | Fires when |
| --- | ---------- |
| `RunStarted` | A test run begins. Carries `runId`, `startedAt`, `configHash` |
| `ModuleQueued` | A test module enters the pending queue |
| `ModuleStarted` | A module begins executing |
| `TestStarted` | A test case is about to run |
| `TestFinished` | A test case produced a result (passed / failed / skipped) |
| `ModuleFinished` | A module completed with tallied counts |
| `CoverageReady` | Coverage analysis is complete |
| `ThresholdViolation` | A coverage metric is below threshold |
| `FailureClassified` | A failing test received a stability classification |
| `SuggestedAction` | An actionable hint emitted from the analysis pipeline |
| `RunFinished` | The run completed; carries final totals |

The discriminator is `_tag`. Exhaustiveness is enforced at the
reducer's `Match.exhaustive` terminator — adding a variant produces a
compile-time failure until handled.

---

## RenderState — the projected shape

Defined in `packages/sdk/src/schemas/RenderState.ts`. The reducer
projects the event stream into this shape:

```ts
interface RenderState {
  phase: "idle" | "running" | "finished";
  runId: string | null;
  configHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  modules: Record<string, ModuleRecord>;
  moduleOrder: string[];                    // insertion order
  totals: RenderTotals;
  coverage: CoverageRenderState | null;
  failures: FailureRecord[];
  suggestedActions: SuggestedActionRecord[];
}
```

Both renderers read this shape. Adding a visible field means: extend
`RenderState`, update the reducer, update both renderers. The
discipline keeps the two surface implementations in sync.

---

## The reducer

Pure synchronous function in `packages/ui/src/reducer.ts`:

```ts
const reduceRenderState = (state: RenderState, event: RunEvent): RenderState
const reduceRenderStateAll = (events: ReadonlyArray<RunEvent>, seed?) => RenderState
```

Implemented as an exhaustive `Match.value(event).pipe(Match.tag(...),
Match.exhaustive)`. No I/O, no time, no randomness. Folding the same
event sequence twice yields the same state.

Notable per-event behaviors:

- `ModuleQueued` is idempotent on `modulePath` — queuing twice does not
  duplicate the moduleOrder entry.
- `ModuleStarted` auto-queues if the module was never queued. Handles
  Vitest configurations that skip the queue notification.
- `TestFinished` with status `failed` appends to `failures` with
  `classification: null`. The optional `FailureClassified` event later
  updates the matching row in place.
- `ModuleFinished` recomputes `totals` across all modules. `RunFinished`
  overrides totals with the runner's authoritative counts at end-of-run.

---

## The two renderers

### Agent renderer

`renderAgent(state, options?): string` in
`packages/ui/src/render-agent.ts`. Produces a markdown-flavored
final-frame string tuned for token economy:

```text
Tests: 2/4 passed, 1 failed, 1 skipped (100ms)

Failures:
- src/math.test.ts > math > divides [new-failure]
  expected 0.5 to equal 0.5000001
  - 0.5000001
  + 0.5

Modules:
- src/math.test.ts: 1 passed, 1 failed
- src/strings.test.ts: 1 passed, 1 skipped

Actions:
- warn: Investigate floating-point comparison
  Use Number.EPSILON instead of strict equality
```

Sections appear conditionally on state. Modules collapse to
`N modules all-passed.` when nothing fails or skips. Coverage gaps
cap at top-3 by missing lines (configurable via `maxCoverageGaps`).
Stack traces are excluded by default (`includeStack: false`); agents
already have structured failure data via MCP tools.

**Stability**: byte-identical output for byte-identical input. No
timestamps in the rendered body — duration is summarized in the
header. Snapshot-friendly.

### Ink renderer

React components in `packages/ui/src/render-ink/`. Composed by `App` at
the root. The tree maps `RenderState` to:

- `<RunSummary>` — header line
- `<FailureSection>` — per-failure rows with classification tag,
  message, colored diff
- `<ModuleRow>` × N — module header + optional per-test rows
- `<CoverageBlock>` — per-metric line + Violations + top-N Gaps
- `<SuggestedActions>` — severity-prefixed action list

Each section is conditional on its slice being non-empty. Components
use Ink primitives only (`<Box>`, `<Text>`, `<Newline>`, `<Spacer>`);
no DOM-style attributes.

Two consumption modes:

- `renderRun(events, mode, options)` — one-shot. Folds events, then
  either `renderAgent(state)` for agent mode or `renderToString(<App
  state />)` for human mode. Returns a string. Used by the CLI `show`
  command and the `eventSourcedReporter` factory.
- `createLiveInk()` — long-running. Mounts via `ink.render()` on
  `RunStarted`, calls `instance.rerender(<App state />)` on each
  subsequent event, schedules `instance.unmount()` on the next tick
  after `RunFinished`. Used by the plugin's live tap.

---

## The console matrix

User-facing options on `AgentPlugin` (`packages/sdk/src/schemas/Options.ts`):

```ts
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "ink" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
  githubSummary?: boolean,
  reporter?: VitestAgentReporterFactory,
  onRunEvent?: (event: RunEvent) => void,
})
```

The plugin auto-detects the executor (`human`, `agent`, `ci`) from the
runtime environment, looks up the matching slot, and resolves a single
`ConsoleMode` value. The resolved value drives two decisions:

1. **Stdout ownership**: any non-`passthrough` value strips Vitest's
   built-in reporters so the plugin owns the channel.
2. **Live tap gating**: `onRunEvent` is forwarded to `AgentReporter`
   only when the resolved mode is `ink`. Other modes either render
   statically or asked for silence — a live mount would leak into
   them.

The factory `eventSourcedReporter` reads `kit.config.consoleMode` and
dispatches:

| Mode | Factory behavior |
| ---- | ---------------- |
| `passthrough` | Returns `[]` — Vitest's reporters do the visible work |
| `silent` | Returns `[]` — nothing visible from the plugin |
| `agent` | One `RenderedOutput` per project carrying the agent string |
| `ink` | Returns `[]` — the live Ink mount via `onRunEvent` owns it |
| `ci-annotations` | Returns `[]` — a dedicated CI emitter will own this (not yet shipped) |

---

## PubSub channel and Effect transport

`packages/ui/src/pubsub/` ships an Effect channel for hosts that want
multi-subscriber fan-out, stream composition, or Layer-based wiring:

```ts
class RunEventChannel extends Context.Tag(...) {} // Tag for PubSub<RunEvent>
const RunEventChannelLive: Layer.Layer<RunEventChannel>  // scoped, unbounded
const publish: (event) => Effect<boolean, never, RunEventChannel>
const publishAll: (events) => Effect<void, never, RunEventChannel>
const accumulateUntilFinished: (initial?) => Effect<RenderState, never, RunEventChannel>
const forEachRenderState: <R, E>(onState, initial?) => Effect<void, E, R | RunEventChannel>
const renderStateStream: (initial?) => Effect<Stream<RenderState>, never, RunEventChannel | Scope>
```

The current production wiring does not use the channel — the live tap
is a plain callback (`onRunEvent`). The channel exists for:

- **Tests**: roundtrip-vs-sync equivalence, multi-subscriber fan-out
  verification.
- **Future remote / forked consumers**: a dashboard process, a tee-to-
  file logger, or a replay system can subscribe without modifying the
  publisher.
- **Effect-fluent hosts**: code already running inside an Effect
  program can compose with `Stream.fromPubSub` operators.

---

## Synthesizers — bridging into the taxonomy

Two converters in `packages/ui/src/synthesize.ts`:

- **`synthesizeRunEvents(modules, options?)`** — accepts duck-typed
  `VitestTestModule[]` (the shape `buildAgentReport` uses). Walks
  modules + children, builds `RunStarted → per-module → per-test →
  RunFinished` sequence. Used by the live publishing path (the plugin's
  streaming callbacks aren't currently routed through this — they
  construct each `RunEvent` inline — but it remains the bridge for any
  batch context that has the live module shape).
- **`synthesizeFromAgentReport(report, options?)`** — accepts the
  persisted `AgentReport` schema. Only failed modules carry per-test
  detail; passed-only modules are summarized via `summary.passed`
  without per-module breakdown. The synthesized stream lets
  `RunFinished` carry the authoritative totals from the summary. Used
  by the CLI `show` command and `eventSourcedReporter.render`.

---

## Factory contract

`eventSourcedReporter` implements `VitestAgentReporterFactory` from the
SDK:

```ts
const factory: VitestAgentReporterFactory = (kit) => ({
  render(input) {
    // For each report in input.reports, synthesize → fold → render
    return input.reports.map(report => renderOne(report, kit.config));
  }
});
```

`makeEventSourcedReporter(options)` returns a customized factory with
`modeOverride` and `width`. The default-options instance is exported as
`eventSourcedReporter` for direct use.

---

## Live-mount lifecycle (`createLiveInk`)

`packages/ui/src/factory/LiveInkRenderer.tsx`:

```ts
interface LiveInkRenderer {
  event(e: RunEvent): void;
  unmount(): void;
  snapshot(): RenderState;
}
const createLiveInk: (options?) => LiveInkRenderer
```

Closure-state orchestration:

- `RunStarted` (or any event that flips `state.phase` from `idle`)
  triggers `ink.render(<App state />)`.
- Subsequent events run the reducer, then `instance.rerender(<App state />)`.
- `RunFinished` schedules `instance.unmount()` on the next tick — late
  enough for the terminal to commit the final frame before alt-screen
  teardown.
- Mount and rerender failures are caught and logged to stderr.
  `snapshot()` still advances; the orchestration never stops just
  because the visible mount is broken.

Hosts wire it via `onRunEvent: live.event` on the plugin. The plugin's
gate ensures the tap only fires when `consoleMode === "ink"`.

---

## Testing strategy

Three granularities:

1. **Reducer unit tests** (`__test__/reducer.test.ts`) — vanilla
   Vitest, no React, no Ink. Per-event-type assertions plus
   fold-over-fixture for the four canonical scenarios.
2. **Agent renderer snapshots** — inline (`render-agent.test.ts`) plus
   file-based goldens for each fixture (`render-agent.golden.test.ts`,
   under `__snapshots__/`).
3. **Ink component snapshots** — per-component (`render-ink/*.test.tsx`)
   plus App integration (`render-ink/App.test.tsx`). All pin `columns:
   80` via `<Box width={80}>` wrapping. ANSI escapes are stripped via
   the `stripAnsi` helper so snapshots remain plain text.

Width edge cases (`FailureSection.width.test.tsx`) cover narrow 50-col
and wide 200-col rendering of long stack traces.

Canonical fixtures in `__test__/fixtures/events.ts` are shared across
all three granularities: `allPassEvents`, `mixedFailEvents`,
`coverageViolationEvents`, `flakyRecoveryEvents`.

---

## Known divergence from main's agent output

The new per-project rendering loses several features the pre-2.0 main
branch provided:

- Compact `Projects (N):` table with one line per project carrying
  pass count, duration, and test-kind breakdown (`int:5 unit:177`).
- Single workspace-wide coverage line + a `Files below aspirational
  target:` table with `% Stmts | % Branch | % Funcs | % Lines |
  Uncovered Line #s` columns.
- `Trend: regressing (48 runs)` line.
- `Total: N passed (Xs)` workspace footer.

The new renderer emits one frame per `AgentReport`, producing six
separate `Tests: …` blocks in a six-project workspace. The data the
restoration needs lives in the existing `AgentReport.tagCounts` field
(test-kind breakdown) and `ReporterRenderInput.trendSummary` (passed
to the factory's `render`) but the new renderer ignores both.

Restoration is tracked in
`docs/superpowers/specs/agent-output-format-restoration.md`. The work
is a focused renderer pass: extend `RenderState` (or add a sibling
`WorkspaceRenderState`), thread the trend summary and per-project
tagCounts through, and add a workspace-aggregate rendering mode to
`renderAgent`. The `eventSourcedReporter` would emit one
`RenderedOutput` (workspace aggregate) instead of N (per project).

---

## Decisions reference

See `../decisions.md` for the recorded design choices:

- The per-executor console matrix (`console.human/agent/ci`) replaces
  the prior `mode` + `strategy` pair.
- The factory pattern stays — `eventSourcedReporter` is a peer of the
  legacy `defaultReporter` from `vitest-agent-reporter`. Users pick.
- Live rendering is a separate channel (`onRunEvent` callback or
  `RunEventChannel` PubSub), not part of the factory's `render`
  contract. Adding lifecycle methods (`start`, `event`, `stop`) to
  the factory was considered and deferred — the callback model is
  simpler and the kit-level events field can be added later if the
  factory needs to subscribe.

---

## CURRENT_UI_VERSION

`packages/ui/src/index.ts` exports `CURRENT_UI_VERSION` (inlined from
`process.env.__PACKAGE_VERSION__` via the package's `rslib.config.ts`
`define`). The constant participates in the shared shape test at
`packages/sdk/__test__/version-constants-shape.test.ts` (asserts all
six runtime `CURRENT_*_VERSION` strings are non-empty and
lockstep-equal) and in the package-local
`packages/ui/__test__/version-constant.test.ts` (asserts it matches
`packages/ui/package.json#version`). No init-time drift check
compares against `CURRENT_UI_VERSION` because `vitest-agent-ui` is
not a hard peer dependency — consumers opt into it explicitly. See
D36 in [../decisions.md](../decisions.md).
