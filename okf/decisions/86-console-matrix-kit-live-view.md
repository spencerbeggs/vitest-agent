---
type: Decision
title: Per-Executor Console Matrix with a Kit-Owned Live View
description: "AgentPluginOptions.console still resolves one ConsoleMode per executor slot, driving stdout ownership and the run-event channel, but the stream mode's live view is now @effected/cli's CliUi.live started by the default reporter's factory, lazily loading its Ink drawing and closed through the optional VitestAgentReporter.close at Vitest's close, in place of the hand-rolled createLiveInk mount."
status: draft
supersedes: 37-per-executor-console-matrix-streaming-reporter-tap.md
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
sources:
  - id: sdk-options
    resource: ../../packages/sdk/src/schemas/Options.ts
  - id: sdk-common
    resource: ../../packages/sdk/src/schemas/Common.ts
  - id: sdk-reporter-contract
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
  - id: reporter-default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
  - id: reporter-stream-view
    resource: ../../packages/reporter/src/streamView.ts
  - id: pr-539
    resource: https://github.com/spencerbeggs/vitest-agent/pull/539
    title: "feat!: adopt the @effected interactive CLI kit and Effect 4.0.0"
  - id: issue-550
    resource: https://github.com/spencerbeggs/vitest-agent/issues/550
integrity:
  generated:
    body: 8dfba690b1676660
---

# Per-Executor Console Matrix with a Kit-Owned Live View

## Context

[Decision 37](37-per-executor-console-matrix-streaming-reporter-tap.md)
replaced the pre-2.0 single-axis `mode` / `strategy` pair with a
per-executor console matrix, and had `DefaultVitestAgentReporter` own a
live Ink mount of its own: `createLiveInk` in
`packages/reporter/src/LiveInkRenderer.tsx` subscribed to the plugin's
run-event channel, drove a spinner off a fixed-cadence `setInterval`, and
unmounted itself when the run ended. That mount was the repository's own
terminal runtime — its own interactivity check, its own colour and width
handling, its own frame commit — written before `@effected/cli` shipped a
live-view primitive. Pull request 539 moved the whole family onto the
`@effected` interactive CLI kit and Effect 4.0.0, and the hand-rolled
mount went with it; `LiveInkRenderer.tsx` and `createLiveInk` no longer
exist.[^pr-539] The matrix itself, the stdout-ownership rule, and the
read-only `onRunEvent` tap all survived unchanged, so this Decision
restates them together with the live view as it now runs, and deprecates
Decision 37 rather than editing a verified record into something it never
described.[^issue-550]

## Decision

**The matrix is unchanged.** `AgentPluginOptions.console` is `{ human?,
agent?, ci? }`, and each slot accepts only the modes valid for that
executor: `HumanConsoleMode` is `passthrough | silent | stream | agent`,
`AgentConsoleMode` is `passthrough | silent | agent`, and `CiConsoleMode`
is `passthrough | silent | ci-annotations`.[^sdk-options][^sdk-common]
`resolveConsoleMode` in `packages/plugin/src/plugin.ts` looks up the slot
matching the executor (engine's `ExecutorResolverLive` maps the detected
`Environment` onto it), with per-executor defaults of `passthrough` for
`human` and `ci` and `agent` for `agent`.[^plugin-ts]

**The override is read through the kit.** `VITEST_AGENT_CONSOLE` is read
by `@effected/env`'s `EnvOverride.readResult` (the exported
`readConsoleOverride`) with the executor supplied as the `Audience` and
each audience's accepted literals taken from the SDK schemas' `.literals`,
so the accepted list cannot drift when a mode is added. Matching is
case-insensitive. A value the executor does not accept is ignored with
one diagnostic line, `[vitest-agent:plugin] ignoring
VITEST_AGENT_CONSOLE=<value>: not accepted for the <executor> audience
(accepts <a>|<b>|...)`, written to the caller's `report` sink (stderr by
default, never stdout) and deduplicated once per Vitest run. The source
is `process.env` as a record, re-read on every run of the effect, so a
change after module load is seen.[^plugin-ts]

**Stdout ownership is unchanged.** `ownsStdout` treats any
non-`passthrough` mode as needing exclusive stdout: the plugin strips
Vitest's built-in console reporters and zeroes `coverage.reporter` so it
owns the terminal for the run.[^plugin-ts]

**The run-event channel and the tap are unchanged.** `AgentReporter`
publishes every `RunEvent` onto an unbounded `PubSub` threaded onto
`ReporterKit.runEvents`, invokes the reporter factory at run start so a
live-painting reporter can subscribe before the first event, and feeds the
user-supplied `onRunEvent` callback off the same stream as a read-only
tee. Events are constructed only when something will read them:
`wantsRunEvents` is true when `onRunEvent` is set, when the resolved mode
is `stream`, or when a custom reporter was supplied.[^plugin-reporter]

**The live view is the kit's `CliUi.live`.** When
`kit.config.consoleMode === "stream"` and `kit.runEvents` is defined, the
default reporter's factory calls `startLiveView(kit.runEvents)` from
`packages/reporter/src/liveView.ts`.[^reporter-default-reporter] That
function hands the channel to `CliUi.liveDetached`, the detached form of
`CliUi.live` that runs the view outside Effect for the reporter's whole
life and subscribes synchronously (before the factory returns, so the
first `RunStarted` is never lost), over `liveViewOptions`: the fold is
`reduceRenderState` from `initialRenderState`, a run begins at
`RunStarted` (or when the first event folds the state out of `idle`) and
ends at `RunFinished` or `RunTimedOut`, the view redraws on every event
and on a `SPINNER_FRAME_MS` tick, and the final frame is committed to
scrollback at the terminal event without clearing the screen, so the
next watch-mode run mounts afresh below it. The mode is `owned`, not
`hosted`: when the run is not interactive (piped, CI) nothing is mounted
and each run's `final` document — the plain `renderAgent` report, one
unwrapped line per report line — is written once to stdout instead, so
`vitest run | cat` still receives the result. The environment the view
reads is `LiveViewEnv`, the kit's `CliEnv.layer()` over `NodeServices`:
colour from the terminal, glyphs `auto` so `TERM=dumb` draws ASCII, the
width the report-time human render lays out at, and interactivity as a
human audience with a TTY on stdin and stdout.[^reporter-live-view]

**The drawing loads lazily.** `liveViewOptions.render` is
`CliUi.lazyView(() => import("./streamView.js"))`, so `liveView.ts` and
everything that imports it load neither React nor Ink; `streamView.ts`
renders `StreamApp` from `@vitest-agent/ui/ink` with the kit's frame index
and is loaded only when a run first mounts its frame (see [Decision
78](78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md)).[^reporter-stream-view]

**Closing is a contract, not a reporter-private detail.**
`VitestAgentReporter` gained an optional `close(): Promise<void>`, called
once at Vitest's close — never per run, since watch mode reruns `render`
many times on one reporter.[^sdk-reporter-contract] The plugin's
`closeReporters` awaits every reporter's `close` first and only then
shuts the run-event `PubSub` down, because a shutdown drops whatever a
subscriber has not pulled yet; a rejected `close` is logged to stderr, not
thrown.[^plugin-reporter] The default reporter returns the live view's
`close` as its own: the detached handle's `close` folds every event
still queued in the subscription, commits the last run, then releases the
view; it is idempotent and never rejects. The view never relies on `PubSub.shutdown` to end
it, and it is never closed at `onTestRunEnd`.[^reporter-live-view]

**Stray output prints above the frame.** The detached handle's
`printAbove` is the default reporter's `printStrayLine`, exposed in
`stream` mode only; it prints a line above the mounted frame, so bytes a
test process wrote straight to the terminal never land under it, and
declines when no frame is mounted (see [Decision
79](79-capture-stray-output-at-vitest-logger-streams.md)).[^reporter-live-view]

**Why keep the factory contract narrow.** The `render(input, kit)`
contract is still a single synchronous batch call, one frame per project
at the end of a run ([Decision 34](34-plugin-reporter-split.md)). Live
rendering stays a reporter-side subscription to the channel plus the one
optional `close` hook, rather than `start`/`event`/`stop` lifecycle
methods, so a reporter that wants only the final frame is still one
function.

## Alternatives rejected

- **Keep the hand-rolled `createLiveInk` mount beside the kit.** Rejected
  because it duplicated what `CliUi.live` provides — interactivity
  detection, colour and glyph resolution, the tick, the final-frame commit,
  printing above the frame — with its own bugs (the stranded-header
  incident was in this area), and because the kit's `CliEnv` is what every
  other front end in the family already reads its audience and theme from.
- **Edit Decision 37 in place.** Rejected because the Decision was
  human-verified against the old mount; a verified record is deprecated
  and replaced, not rewritten into a different implementation.
- **End the view on `PubSub.shutdown` instead of an explicit `close`.**
  Rejected because Effect's shutdown drops messages a subscriber has not
  taken yet, so a tail published just before Vitest closed would be lost;
  the explicit `close` folds the queue first.

## Consequences

- Adding a console mode is still one slot's literal union plus, when the
  mode is for the `human` slot, an `accepts` entry that is derived from the
  same schema's `.literals`, so the override validation cannot lag.
- A custom reporter that wants live data subscribes to `kit.runEvents` and
  may implement `close`; one that wants only the final frame implements
  `render` alone, as before.
- The live view depends on the kit's `CliUi.live` semantics (mount at
  start, commit at terminal event, `owned` mode printing `final` when not
  interactive); a change to those semantics upstream changes what `stream`
  mode draws without a change in this repository.
- Decision 37 is deprecated; its matrix, ownership, and tap rationale are
  carried here verbatim in substance, and its description of the mount is
  history.

## Related

- [Decision 37 — Per-Executor Console Matrix + Streaming Reporter Tap](37-per-executor-console-matrix-streaming-reporter-tap.md) (superseded)
- [Decision 34 — Plugin/Reporter Split](34-plugin-reporter-split.md)
- [Decision 78 — Ink Half behind a ui Subpath, with Lazy Reporter Views](78-ink-half-behind-a-ui-subpath-and-lazy-reporter-views.md)
- [Decision 79 — Capture Stray Output at Vitest's Logger Streams](79-capture-stray-output-at-vitest-logger-streams.md)
- [Module: reporter](../modules/reporter.md)
- [Module: plugin](../modules/plugin.md)
- [Incident: stranded live-view headers](../incidents/2026-10-07-stranded-live-view-headers.md)

[^sdk-options]: `../../packages/sdk/src/schemas/Options.ts`
[^sdk-common]: `../../packages/sdk/src/schemas/Common.ts`
[^sdk-reporter-contract]: `../../packages/sdk/src/contracts/reporter.ts` (`VitestAgentReporter.close`)
[^plugin-ts]: `../../packages/plugin/src/plugin.ts` (`resolveConsoleMode`, `readConsoleOverride`, `ownsStdout`)
[^plugin-reporter]: `../../packages/plugin/src/reporter.ts` (`wantsRunEvents`, `closeReporters`)
[^reporter-default-reporter]: `../../packages/reporter/src/defaultReporter.ts`
[^reporter-live-view]: `../../packages/reporter/src/liveView.ts`
[^reporter-stream-view]: `../../packages/reporter/src/streamView.ts`
[^pr-539]: <https://github.com/spencerbeggs/vitest-agent/pull/539>
[^issue-550]: <https://github.com/spencerbeggs/vitest-agent/issues/550>
