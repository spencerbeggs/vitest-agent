---
type: Decision
title: Shape-Tailored Dispatcher Matrix
description: A 4×3 (RunShape × RunOutcome) dispatcher matrix picks one of twelve cell renderers off a single PubSub event stream, replacing a per-format-flag pipeline and appending an MCP tool-pointer footer to every cell.
status: deprecated
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 8d7c2bb2cec9b85a62a23e6615600f54f72546c53636cd85b5ea035634785bab
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Shape-Tailored Dispatcher Matrix

## Context

A per-formatter pipeline — one factory per output format plus a composing
default — always renders the same shape of output regardless of what
actually ran: a single-test invocation got the same workspace table as a
full monorepo run, and a large workspace run produced noisy per-project
duplication. The plugin owns the default reporter outright; a user supplies
`AgentPlugin({ reporter })` only as a wholesale override, so the default
path needed to pick a genuinely different output shape depending on what
kind of run it is rendering.

## Decision

The plugin publishes events on one live stream that every consumer reads.
`AgentReporter` owns an Effect `PubSub<RunEvent>` channel
(`this.runEvents = Effect.runSync(PubSub.unbounded<RunEvent>())`,
`packages/plugin/src/reporter.ts`), threaded onto
`ReporterKit.runEvents` (`packages/plugin/src/reporter.ts`), and
publishes one event per Vitest callback
(`Effect.runSync(PubSub.publish(this.runEvents, event))`,
`packages/plugin/src/reporter.ts`). `DefaultVitestAgentReporter`
subscribes to that channel as one downstream consumer; the user-facing
`onRunEvent` tap (`packages/plugin/src/reporter.ts`) is a
parallel read-only tee fired for every console mode after the event is
published — not gated by console mode — and a throwing tap is caught and
logged to stderr rather than aborting the run. A `wantsRunEvents()` gate
(`packages/plugin/src/reporter.ts`) skips event construction
entirely when nothing will consume the stream (no `onRunEvent`, console
mode is not `"stream"`, and no custom reporter is registered). Live and
batch ingestion both reduce onto the same `RenderState` shape.

Output shape is selected by classifying `(RunShape, RunOutcome)`, not by a
format flag. `classifyRunShape`
(`packages/ui/src/dispatcher/classify.ts`) reduces the state plus
per-project summaries into one of four shapes — `workspace` when more than
one project ran, `single-test` when the sole module has exactly one test,
`single-file` when it has more than one, `single-project` otherwise.
`classifyOutcome` reduces to one of three outcomes —
`all-pass`/`some-fail`/`threshold-violation`, with failures and timeouts
both winning over threshold violations. `dispatcherTable`
(`packages/ui/src/dispatcher/dispatch.ts`) is the resulting 4×3 table
of `Cell` renderers, and `dispatch(inputs, opts)`
(`packages/ui/src/dispatcher/dispatch.ts`) does a total lookup with no
default fallback — `single-test × threshold-violation` is a documented
no-op cell rather than a special case in the dispatcher itself. Each `Cell`
exposes two halves on one object: `agent(inputs, opts): string` for
token-economy stdout and an `ink(inputs, opts): ReactElement` half for the
live mount.

Each dispatcher cell appends an L1 MCP tool-pointer footer via
`buildFooter` (`packages/ui/src/dispatcher/footer.ts`): an all-pass
outcome with coverage gaps points at `file_coverage`
(`packages/ui/src/dispatcher/footer.ts`); `some-fail` with a
`new-failure`/`persistent` dominant classification points at `test_errors`
plus `failure_signature_get`
(`packages/ui/src/dispatcher/footer.ts`); a `flaky` dominant
classification points at `failure_signature_get` alone; a
`threshold-violation` outcome points at `test_coverage`
(`packages/ui/src/dispatcher/footer.ts`). `dominantClassification`
(`packages/ui/src/dispatcher/footer.ts`) picks the most actionable
classification from the failure list in priority order `new-failure →
persistent → flaky → recovered → stable`. This is the L1 layer of the
"agents don't auto-use MCP tools without a pointer" mitigation.

`DefaultVitestAgentReporter` lives in `@vitest-agent/reporter`, which is
both the default-reporter package and the reference package for
custom-reporter authors; `@vitest-agent/ui` is the pure rendering-primitives
layer — the dispatcher table, cells, and classifiers — the reporter is
assembled from and has no knowledge of the reporter lifecycle. The two stay
separately published so a consumer can depend on the primitives without
pulling in the Ink live-mount lifecycle.

The plugin invokes the reporter factory at run start (`onInit`, via
`initReporters()`), not at run end, so a live-painting reporter is
subscribed to `ReporterKit.runEvents` before the first event fires. The
`render` contract therefore takes a second `kit` argument: the factory
receives a run-start kit (neutral run health) and `render` receives a
run-end, health-aware kit, reusing the same reporter instances constructed
at run start.

## Alternatives rejected

- **A two-ingestion-path design** — one consumer reading `input.reports` at
  end-of-run, a separate live per-event subscription: rejected because it
  would force every consumer wanting the canonical experience to wire both
  a `reporter` factory and an `onRunEvent` tap; collapsing to one upstream
  `PubSub` channel that both the built-in reporter and the user tap read
  keeps there being exactly one source of truth for what happened during a
  run.
- **Always rendering the full workspace table** regardless of run shape:
  rejected as wasteful for a single-test invocation and noisy for a large
  workspace — the shape-classification step exists specifically so a
  single failing test does not need a six-row module table and a workspace
  failure block can stay scoped to the failing project.
- **Format-flag-driven dispatch** (one factory per `--format` value) instead
  of shape-and-outcome classification: rejected as less discoverable — a
  reader chasing a chain of format-aware factories has to trace which flag
  produced which output, where the matrix gives one table with
  deterministic `(shape, outcome)` routing.
- **Gating the `onRunEvent` tap by console mode**: rejected because a host
  driving its own live renderer or debug logging from the tap should not
  have to also opt into a particular console mode just to receive events;
  the tap fires independently of what the built-in reporter is doing.

## Consequences

- Adding a new run shape or outcome means extending the two enums in
  `packages/sdk/src/contracts/dispatcher.ts` and adding a row (or column) of
  cells to `dispatcherTable`; the dispatcher's lookup itself stays a
  one-liner and never grows conditional branches.
- A cell author owns both an `agent` and an `ink` half on the same object —
  the two halves cannot drift out of sync about which `(shape, outcome)`
  pair they render, but every new cell is two implementations, not one,
  plus its snapshots.
- Anything that wants the canonical per-event stream — a custom live
  renderer, debug tooling — subscribes to `ReporterKit.runEvents` or wires
  `onRunEvent`; there is no second batch-only event source to reach for
  instead.
- The footer mapping in `buildFooter` is the single place that decides
  which MCP tool an agent is pointed at next; a new MCP tool that should be
  surfaced from run output is wired in there, not duplicated per cell.

## Related

- [DataModel: dispatcher-matrix](../models/dispatcher-matrix.md)
- [Module: ui](../modules/ui.md)
- [Module: reporter](../modules/reporter.md)
