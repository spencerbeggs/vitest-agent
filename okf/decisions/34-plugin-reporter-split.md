---
type: Decision
status: stable
title: Plugin/Reporter Split
description: The plugin owns lifecycle, persistence, and coverage analysis while @vitest-agent/reporter ships a small synchronous render contract so a custom reporter is one factory function.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 8f55ebbd2b529dd95abdd51a37bc729dd74fe603ef8c3e072d37ac62e6af060f
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Plugin/Reporter Split

## Context

Rendering and persistence used to be pulled together into a single Vitest
`Reporter` class, so a custom-output author who only wanted to change what
appears in the terminal had to subclass and re-integrate with Vitest's
lifecycle, coverage, classification, and baseline machinery at the same
time. Splitting the concerns into a carrier package and a small,
synchronous rendering contract lets a custom reporter be a single factory
function instead of a Vitest `Reporter` subclass.

## Decision

`@vitest-agent/plugin` (`packages/plugin/`) owns the Vitest plugin, the
internal `AgentReporter` Vitest-API class, `CoverageAnalyzer`,
`ReporterLive`, and reporter-side utilities. `AgentReporter.onInit`
(`packages/plugin/src/reporter.ts`) stores the Vitest instance and
calls `initReporters()` (`packages/plugin/src/reporter.ts`), which
builds a `ReporterKit` and invokes the user-supplied factory
(`opts.reporter(kit)`, `packages/plugin/src/reporter.ts`) before any
streaming hook fires — so a reporter that paints live can subscribe to the
run-event channel before the first event. `onTestRunEnd` calls `render`
on each resolved reporter and concatenates the `RenderedOutput[]` results
(`packages/plugin/src/reporter.ts`), then routes by target.

`@vitest-agent/reporter` (`packages/reporter/`) is the default reporter
package and the reference package for custom-reporter authors. It ships
`DefaultVitestAgentReporter` — the preassembled `VitestAgentReporterFactory`
the plugin wires as its built-in default
(`packages/plugin/src/reporter.ts`) — and re-exports the factory
contract types from `@vitest-agent/sdk` plus the `buildDispatchInputs` /
`resolveCellOptions` dispatch helpers (`packages/reporter/src/index.ts`)
so a custom-reporter author gets a real worked example and everything
they need from one package. There are no per-format named factories; the
shape-tailored dispatcher matrix (see
[Decision 41](./41-shape-tailored-dispatcher-matrix.md)) replaced that
pipeline.

The contract types live in `@vitest-agent/sdk`
(`packages/sdk/src/contracts/reporter.ts`): `ResolvedReporterConfig`,
`ReporterKit`, `ReporterRenderInput`,
`VitestAgentReporter` — a single synchronous `render(input, kit)` method
returning `RenderedOutput[]` — and `VitestAgentReporterFactory`,
typed to return one reporter or a `ReadonlyArray` of reporters.

**Why "reporter as renderer-only" beats "reporter as Vitest-lifecycle
handler".** The Vitest `Reporter` API is a low-level surface that needs
careful integration with persistence, classification, baselines, and
trend computation — non-negotiable work every consumer needs. Output
decisions on top of that are highly opinionated and per-consumer. Pulling
rendering into a small synchronous contract means custom reporters are
one factory function with no Vitest `Reporter` subclass, the contract has
no Effect requirements and no lifecycle or I/O, and persistence runs
exactly once per run regardless of how many reporters the factory
returns.

**Why the factory returns
`VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`.** Vitest's own
multi-reporter pattern (`reporters: ['default', 'github-actions']`) is the
obvious shape for "multiple outputs from one run". Modeling it directly
means a factory can emit multiple sinks — for example stdout plus a
GitHub Step Summary entry — without a separate "composite reporter"
abstraction. `DefaultVitestAgentReporter` handles this internally by
emitting one `RenderedOutput` per active target rather than returning an
array of reporters, but the array form remains part of the contract for
custom-reporter authors who want to compose. Each reporter sees the same
`ReporterKit` and `ReporterRenderInput`; their `RenderedOutput[]` results
are concatenated in factory-declaration order before routing.

**Where the default reporter lives.** `DefaultVitestAgentReporter` and the
live Ink mount live in `@vitest-agent/reporter`, the package that
assembles a reporter from the `@vitest-agent/ui` primitives and is the
canonical worked example for custom-reporter authors.
`@vitest-agent/ui` stays the pure rendering-primitives library. The two
stay separately published — `ui`'s anticipated second consumer is a
planned MCP triage-dashboard app, so merging then resplitting would cost
two breaking changes. Live-rendering orchestration lives in
`DefaultVitestAgentReporter`, not the plugin: the plugin owns the
run-event channel and hands it to the reporter (see
[Decision 37](./37-per-executor-console-matrix-streaming-reporter-tap.md)).

The agent plugin manifests (for Claude Code,
`plugin/builds/claude/.claude-plugin/plugin.json`) declare the plugin name
`vitest-agent` — a separate identity from the npm packages.
Hook scripts resolve and call the CLI bin `vitest-agent`
(`va_cli` in `plugin/hooks/lib/vitest-agent/common.sh`).

## Alternatives rejected

- **Reporter as a Vitest-lifecycle handler** (subclassing Vitest's
  `Reporter` directly for custom output): rejected because it forces every
  custom-output author to re-integrate with persistence, classification,
  baselines, and trend computation just to change what gets printed.
- **A single reporter return value instead of `| ReadonlyArray<...>`**:
  rejected because Vitest's own multi-reporter pattern is the natural
  shape for "multiple outputs, one run"; a single-value contract would
  have forced a bespoke composite-reporter abstraction on top.
- **Merging `@vitest-agent/ui` and `@vitest-agent/reporter` into one
  package**: rejected because `ui`'s anticipated second consumer (a
  planned MCP triage-dashboard app) does not need the reporter-lifecycle
  half, and merging then resplitting later would cost two breaking
  changes instead of zero.

## Consequences

- A custom reporter author never subclasses a Vitest `Reporter`; they
  write one function conforming to `VitestAgentReporterFactory` and pass
  it as `AgentPluginOptions.reporter`.
- Persistence and classification logic can evolve inside
  `@vitest-agent/plugin` without touching `@vitest-agent/reporter`'s
  public contract, since the contract is deliberately narrow.
- Adding a stateful, streaming capability to the reporter contract itself
  (rather than through the `onRunEvent` tap and `runEvents` `PubSub`) would
  break the "single synchronous batch call" guarantee this split depends
  on.

## Related

- [Decision 33 — Package Split](./33-package-split.md)
- [Decision 37 — Per-Executor Console Matrix + Streaming Reporter Tap](./37-per-executor-console-matrix-streaming-reporter-tap.md)
- [Decision 41 — Shape-Tailored Dispatcher Matrix](./41-shape-tailored-dispatcher-matrix.md)
