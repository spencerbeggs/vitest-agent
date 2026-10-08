---
type: Interface
title: Reporter contract
description: The consumer-facing contract between AgentPlugin and any VitestAgentReporterFactory implementation.
kind: api
resource: ../../packages/sdk/src/contracts/reporter.ts
tags:
  - dx
  - compat
  - effect
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: 290281c9ce43412b519b01692a215b381f1d45550f5b661f3ec88686b5933c04
sources:
  - id: contract-reporter
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: contract-formatters-types
    resource: ../../packages/sdk/src/formatters/types.ts
---

# Interface: reporter contract

## What stays stable

`packages/sdk/src/contracts/reporter.ts` is the public boundary between
`@vitest-agent/plugin` and anyone implementing a
`VitestAgentReporterFactory` — the named factories in
`@vitest-agent/reporter`, or a third-party reporter.[^contract-reporter] A
consumer depends on five exported types plus one shape from the
formatters module; none require Vitest-API awareness, I/O, or an Effect
runtime to implement.

**`VitestAgentReporterFactory`** — `(kit: ReporterKit) =>
VitestAgentReporter | ReadonlyArray<VitestAgentReporter>`. The plugin
calls this once per Vitest session, at `onInit`, with the resolved
run-start kit; in watch mode the same reporters are reused for every
rerun. Returning an array models
Vitest's own multi-reporter pattern (`reporters: ['default',
'github-actions']`): each reporter handles one concern and the plugin
concatenates their `RenderedOutput[]` before routing. Persistence still
runs exactly once regardless of how many reporters are returned — the
plugin owns the Vitest lifecycle and no reporter ever sees a raw Vitest
event.

**`VitestAgentReporter.render(input, kit) => ReadonlyArray<RenderedOutput>`**
— the one required method. It is synchronous, takes no Vitest types, and
does no I/O. `render` is called once per test run, after the plugin has
finished persisting and classifying. It receives a *second* `ReporterKit`
distinct from the one the factory got: the factory's kit is resolved at
run start (before any failure is known), while `render`'s kit is resolved
at run end and reflects the real post-run `detail`. A reporter doing
construction-time work reads the factory kit; a reporter that only
renders reads the `render` kit. A no-op reporter that only wants
persistence (the MCP/CLI tools still see the data) is one line:
`() => ({ render: () => [] })`.

**`VitestAgentReporter.close?() => Promise<void>`** — optional. Release
what the factory acquired (a subscription, a live view's scope). The
plugin calls it once, at Vitest's close (`vitest.onClose`), never per
run, awaits every reporter's `close`, and only then shuts the
`runEvents` channel down. The order is load-bearing: Effect's
`PubSub.shutdown` drops whatever a subscriber has not pulled yet, so a
subscriber drains its subscription and ends its own stream inside
`close`. A rejection is logged to stderr, never thrown.[^contract-reporter]

**`VitestAgentReporter.printStrayLine?(stream, line) => boolean`** —
optional. Print one whole line of stray output: bytes a test process wrote
straight to the terminal, past Vitest's console capture (a child process
spawned with inherited stdio is the usual source). A reporter that draws in
place (a live view) implements it to print the line above its drawing
instead of under it, where the next redraw would strand it. Return `true`
when the line was taken; `false` sends it to the terminal unchanged, and a
throw is treated as `false`. The plugin calls it synchronously, from the
factory's return until just before `close`, only for lines bound for the
process's own stdout or stderr (never when Vitest was handed other streams,
as MCP's `run_tests` does), and only while the plugin owns the console
(every `consoleMode` but `passthrough`). The line carries no trailing
newline. When several reporters implement it, the first one that returns
`true` wins. Without it every line passes through unchanged; the run's
stray output is reported on `AgentReport.strayOutput` either
way.[^contract-reporter] `DefaultVitestAgentReporter` implements it only in
`stream` mode. See [Decision
79](../decisions/79-capture-stray-output-at-vitest-logger-streams.md).

**`ReporterKit`** — the named-field bag handed to the factory at
construction time and, in its run-end form, to `render`. Fields a
consumer may rely on:

- `config: ResolvedReporterConfig` — see below.
- `stdEnv` — the detected `Environment`.
- `stdOsc8(url, label)` — a pre-bound OSC-8 hyperlink helper; the plugin
  has already decided whether OSC-8 is appropriate (target is stdout,
  `!noColor`), so a reporter calls it without consulting environment
  itself.
- `runEvents?: PubSub.PubSub<RunEvent>` — the live run-event channel. The
  plugin publishes one `RunEvent` per Vitest streaming callback onto this
  `PubSub` as the run progresses; see
  [DataModel: run-events](../models/run-events.md) for the variant
  taxonomy. A reporter that paints live subscribes here at construction
  time (the factory runs at run start, before the first event) and drives
  its own renderer off the stream. Optional at the type level so a
  reporter built directly without the plugin (a test, a one-shot replay)
  can omit it; the plugin always populates it in production.

The `std*`-prefixed fields (`stdEnv`, `stdOsc8`) mark "the plugin gives
you these — do not re-derive equivalents yourself." The shape is
deliberately open: a future field never breaks an existing reporter
because reporters destructure only what they consume.[^contract-reporter]

**`ResolvedReporterConfig`** — the plugin's resolved configuration. A
consumer may read any field without triggering a major on that field's
addition; fields that are pure user options mirror
[Interface: agent-plugin-options](agent-plugin-options.md), while others
are per-run resolved facts a reporter cannot get any other way:

- `coverageMode: "full" | "ui-only"` — required. Resolved from Vitest's
  native `coverage.enabled` (`false` maps to `ui-only`); a reporter that
  branches on persistence availability reads this rather than reaching
  for coverage config itself.
- `executor: Executor` (`human` / `agent` / `ci`) and `consoleMode:
  ConsoleMode` — the two fields a reporter reads to answer "what am I
  supposed to produce right now?"
- `transport?: Transport` — the resolved backend binding (`{ kind:
  "local" }` today); a reporter branches on backend kind here rather than
  importing transport config independently.
- `dbPath?`, `noColor`, `detail`, `runCommand?`,
  `passWithNoTests?`, and the coverage/console-shaping fields
  (`coverageThresholds?`, `coverageTargets?`, `consoleOutput`,
  `omitPassingTests`, `coverageConsoleLimit`, `includeBareZero`,
  `githubActions`, `githubSummary`, `githubSummaryFile?`) — all optional
  or plugin-internal defaults a reporter may branch on but never must.

`ResolvedReporterConfig` no longer has a `format` field, and neither the
sdk nor `@vitest-agent/reporter` exports an `OutputFormat` type any more
(issue 558). A reporter that branched on `format` branches on
`consoleMode` and `executor` instead, which carry the same information; see
[Decision 77](../decisions/77-three-stage-output-pipeline-without-format-selection.md).

**`ReporterRenderInput`** — the per-run data `render` receives:
`reports: ReadonlyArray<AgentReport>` (one per Vitest project),
`classifications: ReadonlyMap<string, TestClassification>` keyed by
`TestReport.fullName` (`stable` / `new-failure` / `persistent` / `flaky`
/ `recovered`), and an optional `trendSummary` present only on a full
(non-scoped) run where coverage trends were computed.

## RenderedOutput targets

`RenderedOutput` (`packages/sdk/src/formatters/types.ts`) is a
discriminated union on `target`.[^contract-formatters-types] `render`
returns `RenderedOutput[]`; the plugin — never the reporter — routes each
entry to its destination, so a reporter implementation never opens a
write stream or resolves a path itself:

- `stdout` — `{ content, contentType }`, written to the process's real
  stdout.
- `github-summary` — `{ content, contentType }`, appended to the
  configured `GITHUB_STEP_SUMMARY` file; dropped silently outside GitHub
  Actions.
- `report` — adds a flat `filename` on top of `{ content, contentType }`
  and is written into Vitest 5's `.vitest/<scope>/` report directory (see
  [Interface: report-files](report-files.md)); dropped when report files
  are disabled.
- `file` — reserved, currently a no-op regardless of content; see
  [Limitation: file-output-target-reserved](../limitations/file-output-target-reserved.md).

## What a custom reporter may rely on

- The contract types live in `@vitest-agent/sdk`, not in the plugin or
  the reference reporter package, specifically so a custom reporter never
  takes a runtime dependency on either.
- `render` is guaranteed synchronous and side-effect-free with respect to
  Vitest: no Vitest-API type appears anywhere in the contract.
- The factory is invoked exactly once per Vitest session per `reporter`
  entry (multiple entries from an array are each invoked once), before
  the first `RunEvent`, so a live-painting reporter never misses an event
  by subscribing at construction time.
- `close`, when present, runs before the run-event channel is shut down,
  so everything published is still pullable inside it.
- `printStrayLine`, when present, is never called after `close` begins:
  the plugin stops routing stray lines before it awaits any reporter's
  `close`.
- Persistence and classification always finish before `render` is
  called; a reporter never has to guard against a still-in-flight
  `DataStore` write when reading `ReporterRenderInput.classifications`.
- A reporter that ignores `runEvents` and does not implement live
  painting is a fully conforming, minimal implementation — the contract
  does not require it.

[^contract-reporter]: `../../packages/sdk/src/contracts/reporter.ts`
[^contract-formatters-types]: `../../packages/sdk/src/formatters/types.ts`
