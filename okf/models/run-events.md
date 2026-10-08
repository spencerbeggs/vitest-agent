---
type: DataModel
title: RunEvent and RenderState
description: "The RunEvent discriminated union, the ordering guarantees the reducer relies on, and the RenderState it projects — the shape both the Ink and agent renderers read instead of the raw event stream."
resource: ../../packages/sdk/src/schemas/RunEvent.ts
status: draft
tags:
  - architecture
  - effect
  - observability
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: edc4e503f9ee2df627c7e86659d0952f629ea73747889966af200fec46b0d2a9
---

# RunEvent and RenderState

## What this covers

`RunEvent` (`packages/sdk/src/schemas/RunEvent.ts`) is a 23-variant
`Schema.Union` of `Schema.TaggedStruct`s — the single vocabulary a run's
progress is expressed in, whether the source is a live Vitest reporter
callback or a replayed persisted `AgentReport`[^run-event]. `RenderState`
(`packages/sdk/src/schemas/RenderState.ts`) is the accumulated projection a
pure reducer folds that stream into; every renderer (the `stream` live
view's `StreamApp` tree, the agent-mode markdown string, the dispatcher matrix's cells) reads
`RenderState`, never the raw event sequence. Getting either side wrong
breaks a renderer either at compile time (the reducer's exhaustiveness
check) or silently at runtime (a variant with no reducer case renders
nothing).

## The event variants and their payloads

Every variant is a `Schema.TaggedStruct` — a JSON-serializable discriminated
union member with a fixed `_tag`. Grouped by what they report:

- **Run lifecycle** — `RunStarted` (`runId`, `startedAt`, `configHash`),
  `RunFinished` (final `passCount`/`failCount`/`skipCount`/`durationMs`,
  optional `timeoutCount`, `collectedModules`, `unhandledErrors`,
  `strayOutput`),
  `RunTimedOut` (`message`) — the terminal event when `onProcessTimeout`
  fires instead of a normal finish.
- **Module lifecycle** — `ModuleQueued`, `ModuleStarted`, `ModuleFinished`
  (with per-module pass/fail/skip/timeout counts and optional
  `tagCounts`), `ModuleCollected` (`testCount`, `suiteCount`).
- **Suite and test lifecycle** — `SuiteStarted`, `SuiteFinished`,
  `TestStarted`, `TestFinished` (`status`, `durationMs`, optional `error`,
  optional `timedOut`).
- **Hooks** — `HookStarted`, `HookFinished` (`hookType`, `scopeName`,
  `status`, optional `error`).
- **Side-channel signals** — `ConsoleLog` (captured stdout/stderr),
  `TestAnnotated` / `TestArtifactRecorded` (Vitest's `context.annotate()`
  and custom-artifact surface, each carrying `attachments`), `WatcherReady`
  / `WatcherRerun` (watch-mode signals).
- **Coverage and trend** — `CoverageReady` (`metrics`, `thresholds`, `gaps`,
  and the optional `scoped` / `scopedFiles` / `totalFiles` triad — issue
  #160, set only when a run's coverage was computed against a subset of the
  project's test files), `ThresholdViolation` (one per breached metric),
  `TrendComputed` (`direction`, `runCount`).
- **Classification and guidance** — `FailureClassified`
  (`modulePath`/`testName`/`classification`), `SuggestedAction`
  (`severity`, `title`, `detail`, optional `targetTool`).

`RunEventByTag` is a convenience mapped type (`{ [E in RunEvent as
E["_tag"]]: E }`) for callers constructing one variant by tag without
pulling the whole union into scope[^run-event-bytag].

## Ordering guarantees

The reducer assumes events arrive in the order Vitest's own lifecycle
callbacks fire — `RunStarted` before any module event, `ModuleStarted`
before that module's `TestStarted`/`TestFinished` pairs, `ModuleFinished`
after all of a module's tests resolve, `RunFinished` or `RunTimedOut` last.
Nothing enforces this at the type level; it is a contract between the
publisher (the reporter's callback wiring, or a report-replay synthesizer)
and the reducer. Two of `RenderState`'s design choices exist specifically to
tolerate deviation from strict ordering without crashing:

- `updateModule` (the reducer's internal helper) seeds a fresh
  `queuedModule` record on first reference if a `TestStarted` or
  `ModuleFinished` arrives for a `modulePath` the reducer has not seen a
  `ModuleQueued`/`ModuleStarted` for yet — a missing queue event degrades to
  a module appearing mid-stream rather than throwing.
  `appendModuleIfNew` similarly no-ops a duplicate `ModuleQueued`.
- `upsertTest` / `upsertFailure` key on `(testName, suitePath)` and replace
  in place rather than append, so a duplicate or out-of-order
  `TestFinished` for the same test corrects the prior entry instead of
  producing two rows.

A genuinely out-of-order `RunFinished` (arriving before some modules'
`ModuleFinished`) is not tolerated the same way: `RunFinished` overwrites
`totals` wholesale from its own counts rather than trusting
`recomputeTotals`, so a premature `RunFinished` freezes `totals` at
whatever the runner reported at that instant — this is why `RunFinished`
carries its own authoritative totals rather than the reducer deriving them
from `moduleOrder` (see *Honest reporting*, below).

## What the reducer derives

`reduceRenderState(state, event)` in `packages/ui/src/reducer.ts` is an
exhaustive `Match.tagsExhaustive` switch (chosen over
per-`Match.tag` chaining because the 23-variant union blows past `pipe`'s
20-argument overload ceiling)[^reducer]. Per event:

- `RunStarted` resets to `initialRenderState` with `phase: "running"` — a
  watch-mode rerun's fresh `RunStarted` must paint into a clean slate, so
  modules, totals, coverage, trend, failures, and suggested actions from
  the previous run are discarded, not merged.
- `ModuleFinished` recomputes `totals` by summing every module's own
  counts (`recomputeTotals`), keeping `RenderState.totals` consistent with
  `RenderState.modules` at every intermediate point during a run.
- `TestFinished` with `status === "failed"` additionally upserts into
  `RenderState.failures`, seeding `classification: null`; a later
  `FailureClassified` event patches that same row in place by
  `(modulePath, testName)` match — a failure can and does exist in
  `RenderState` before its classification arrives, because classification
  runs as a separate pipeline stage.
- `CoverageReady` / `ThresholdViolation` build `RenderState.coverage`
  incrementally: `CoverageReady` sets `metrics`/`thresholds`/`gaps` (and the
  scoped triad when present) while preserving any `violations` already
  accumulated; each `ThresholdViolation` appends one entry. If
  `ThresholdViolation` arrives before any `CoverageReady`,
  `state.coverage === null` and the event is a no-op — coverage can only
  accumulate violations once it exists.
- `RunTimedOut` sets `phase: "timed-out"`, a terminal phase distinct from
  `"finished"` so the renderer knows to paint a final frame rather than wait
  indefinitely for a `RunFinished` that will never arrive.
- Nine variants (`ModuleCollected`, `SuiteStarted`, `SuiteFinished`,
  `HookStarted`, `HookFinished`, `ConsoleLog`, `TestAnnotated`,
  `TestArtifactRecorded`, `WatcherReady`, `WatcherRerun`) are documented
  no-ops today — every `PubSub` subscriber and the `onRunEvent` tap still
  receive them, but neither shipped renderer folds them into
  `RenderState`. A future consumer (a planned MCP dashboard, an analytics
  tap) opts in without any plugin change, because the events already flow
  through the `PubSub`.

`RenderState` itself carries `phase` (`idle` / `running` / `finished` /
`timed-out` — the layout discriminator agent mode uses to know when to emit
its one final frame, and human mode uses to know when to stop redrawing),
`modules` (keyed by `modulePath` so out-of-order updates land in the right
slot) plus `moduleOrder` (insertion order, for renderers that need a stable
row sequence), `totals`, `coverage`, `trend`, `failures`,
`suggestedActions`, `collectedModules`, `unhandledErrors`, and the
optional `strayOutput`.
`collectedModules` and `unhandledErrors` are both optional-at-the-event,
required-at-the-state fields folded from `RunFinished` specifically so a
report replay (which only synthesizes events for *failing* modules) does
not undercount a fully green run to zero modules, and so a process-level
unhandled error can never be hidden behind an all-pass summary.
`strayOutput` is the exception to that pattern: optional on `RunFinished`
and optional on `RenderState`, copied only when the event carries it, and
absent whenever the run wrote nothing past Vitest's console capture (or
the plugin did not own the console). It is a run-level value with no
owning module, and it is never persisted ([Decision
79](../decisions/79-capture-stray-output-at-vitest-logger-streams.md)).

## The run-event PubSub

Run events travel on a plain Effect `PubSub<RunEvent>` that the plugin owns:
`AgentReporter` creates an *unbounded* `PubSub` per run and threads it onto
`ReporterKit.runEvents`. The reporter's `stream` live view consumes it
directly through `@effected/cli`'s `CliUi.live`. `@vitest-agent/ui` ships no
channel service or subscriber helpers. Unbounded is deliberate: events can
arrive faster than a slow renderer drains them (several `TestFinished` per
millisecond during a large suite), and dropping an event would leave
`RenderState` permanently inconsistent with the runner's actual outcome —
there is no way to later reconcile a dropped `TestFinished` into `totals`. A
call site under memory pressure swaps in `PubSub.sliding` with a tuned
capacity instead of changing the default.

## What breaks when a variant is added without a reducer case

Adding a `Schema.TaggedStruct` to the `RunEvent` union without a
corresponding key in `reducer.ts`'s `Match.tagsExhaustive` block is a
**compile-time failure**, not a runtime gap — `Match.tagsExhaustive`'s type
signature requires every tag in the input union to have a handler, so
`packages/ui/src/reducer.ts` fails to typecheck the moment a new variant is
added anywhere upstream, forcing the reducer to be updated in the same
change. `packages/ui/__test__/reducer.test.ts` (641 lines) additionally
pins the *runtime* behavior of every variant individually, so a handler that
compiles but folds the payload incorrectly (wrong field, wrong branch) still
fails a test rather than shipping silently. There is no equivalent
compile-time guard on the two synthesizer functions
(`synthesizeRunEvents` for live Vitest module data,
`synthesizeFromAgentReport` for persisted-report replay,
`packages/ui/src/synthesize.ts`) — a new event derivable from either source
has to be added to both by hand, and nothing fails to compile if one is
missed; only a missing-event test would catch it.

[^run-event]: `../../packages/sdk/src/schemas/RunEvent.ts:80`
[^run-event-bytag]: `../../packages/sdk/src/schemas/RunEvent.ts:250`
[^reducer]: `../../packages/ui/src/reducer.ts:117`
