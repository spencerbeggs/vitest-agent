---
type: Decision
status: stable
title: Per-Executor Console Matrix + Streaming Reporter Tap
description: AgentPluginOptions.console resolves one ConsoleMode per executor slot, driving stdout ownership and an optional live Ink mount fed by a RunEvent PubSub channel and read-only onRunEvent tap.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: ed1d364474ca53c09d4639d1750481815ccd4879334803d4f76e6aeec7d48aa1
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Per-Executor Console Matrix + Streaming Reporter Tap

## Context

A pre-2.0 form used a single `mode: "agent" | "human" | "ci"` option
paired with a `strategy: "own" | "complement"` flag to control console
behavior globally. That single-axis choice could not express the
realistic split where humans want a live Ink mount, agents want a
markdown final frame, and CI wants GitHub annotations, all from the same
`vitest.config.ts`; a user debugging a CI failure locally had to flip the
option (or an environment variable) just to change rendering. A rename of
`consoleStrategy` to `strategy` carried the same limitation forward
without changing it.

## Decision

The plugin resolves console behavior through a per-executor matrix:
`AgentPluginOptions.console: { human?, agent?, ci? }`
(`packages/sdk/src/schemas/Options.ts`). Each slot accepts only the
modes valid for that executor —
`HumanConsoleMode` is `passthrough | silent | stream | agent`,
`AgentConsoleMode` is `passthrough | silent | agent`, and
`CiConsoleMode` is `passthrough | silent | ci-annotations`
(`packages/sdk/src/schemas/Common.ts`). `resolveConsoleMode`
(`packages/plugin/src/plugin.ts`) auto-detects the executor via
`EnvironmentDetector`, looks up the matching slot with a per-executor
default (`passthrough` for `human` and `ci`, `agent` for `agent`), and
also honors a `VITEST_AGENT_CONSOLE` environment-variable override
validated per-slot against the same literal union — an invalid override
value is ignored with a stderr warning naming the accepted values for
that executor. The resolved `ConsoleMode` flows into every reporter
through `ReporterKit.config.consoleMode`.

Two derived behaviors fall out of the resolved mode:

1. **Stdout ownership.** `ownsStdout` treats any non-`passthrough` value
   as needing exclusive stdout access
   (`packages/plugin/src/plugin.ts`); the plugin strips Vitest's
   built-in console reporters and zeroes `coverage.reporter`
   (`packages/plugin/src/plugin.ts`) so it owns stdout for the run.
2. **Live mount activation.** When `consoleMode === "stream"`, a live Ink
   mount paints during the run. The plugin does not instantiate that
   mount itself — it publishes `RunEvent`s onto a `PubSub` channel
   threaded onto `ReporterKit.runEvents`
   (`packages/sdk/src/contracts/reporter.ts`), and
   `DefaultVitestAgentReporter` subscribes to it and owns the mount
   lifecycle. The plugin invokes the reporter factory at run start
   (`onInit` → `initReporters`, `packages/plugin/src/reporter.ts`)
   so a live-painting reporter can subscribe before the first event. The
   user-supplied `onRunEvent` callback is a separate read-only stream tee
   (`packages/plugin/src/reporter.ts`), forwarded whenever the
   reporter wants run events at all — not gated to `stream` mode alone.

The `human`-slot value is named `stream`, describing the user-visible
behavior rather than the rendering library: it renders a
progressively-drawn, colored, animated view of the agent's run-shape
data. The internal `RunEvent` surface is complete — every Vitest reporter
hook `AgentReporter` implements fires a matching `RunEvent`
(`packages/plugin/src/reporter.ts`, `emit`) — and a wall-clock
animation clock in `createLiveInk` drives the spinner glyph and the
ticking elapsed column via a fixed-cadence `setInterval`
(`packages/reporter/src/LiveInkRenderer.tsx`), with the spinner
frame index derived from wall-clock time rather than an event count.

**Why a per-executor matrix beats a single `mode` enum.** Humans, agents,
and CI runners want different visible behavior from the same config file.
The pre-2.0 `mode` enum forced one global choice. The matrix lets one
`vitest.config.ts` declare "live Ink for humans, markdown final-frame for
agents, GHA annotations on CI" simultaneously, and the plugin picks the
right slot based on where it is running. Each slot's legal-mode set is
narrowed at the type level: it is impossible to ask for an Ink mount on a
CI run, or for GitHub annotations on a human terminal.

**Why a callback rather than putting live rendering on the factory
contract.** The `VitestAgentReporter.render(input, kit)` contract is
deliberately a single synchronous batch call — one frame per project, at
end of run (see [Decision 34](./34-plugin-reporter-split.md)). Adding
`start`/`event`/`stop` lifecycle methods to the factory would couple
every reporter to the streaming surface even when it only needs the
final frame. The callback model keeps the contract narrow:
`DefaultVitestAgentReporter` owns the live mount by subscribing to the
run-event `PubSub` channel at factory-invocation time, and the
user-facing `onRunEvent` tap is a separate read-only stream tee for
custom dashboards, log forwarders, or analytics sinks.

**Why retire `strategy` (`"complement"` / `"own"`).** The two states were
"let Vitest's reporters run and persist" versus "strip Vitest's reporters
and emit our own". Both are now expressible as `console.{slot}` values —
`passthrough` for the former, any other mode for the latter — without a
redundant top-level toggle. The matrix subsumes the strategy flag and
gives finer control along the way.

## Alternatives rejected

- **A single global `mode: "agent" | "human" | "ci"` enum plus a
  `strategy: "own" | "complement"` flag** (the pre-2.0 form, and its
  `consoleStrategy` → `strategy` rename): rejected because a single-axis
  choice cannot express "live Ink for humans, markdown for agents, GHA
  annotations on CI" from one config file at once — a user had to flip a
  global option just to change rendering for one executor.
- **Lifecycle methods (`start`/`event`/`stop`) on the reporter factory
  contract**: rejected because it would couple every reporter — including
  ones that only need the final frame — to the streaming surface, and
  would compromise the deliberately narrow single-synchronous-call
  contract from Decision 34.

## Consequences

- Adding a new console mode to one executor slot means widening only that
  slot's literal union (`HumanConsoleMode`, `AgentConsoleMode`, or
  `CiConsoleMode`) — the type system prevents that mode from leaking into
  a slot where it makes no sense.
- Any reporter that wants live data during the run, not just at the end,
  must subscribe to the `RunEvent` `PubSub` channel rather than relying on
  the `render(input, kit)` contract, which fires exactly once.
- A `VITEST_AGENT_CONSOLE` override is validated against the executor
  Vitest actually detected at runtime, not against every mode in the
  matrix — an override that only makes sense for a different executor is
  silently rejected with a stderr warning rather than applied.

## Related

- [Decision 34 — Plugin/Reporter Split](./34-plugin-reporter-split.md)
- [Decision 41 — Shape-Tailored Dispatcher Matrix](./41-shape-tailored-dispatcher-matrix.md)
