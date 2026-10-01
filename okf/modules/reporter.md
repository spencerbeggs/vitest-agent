---
type: Module
title: "@vitest-agent/reporter"
description: The default VitestAgentReporterFactory, report files, the stream-mode live Ink mount, and the reference surface for custom-reporter authors.
kind: package
layer: L3
resource: ../../packages/reporter
tags: [architecture, effect, dx]
status: stable
sources:
  - id: reporter-index
    resource: ../../packages/reporter/src/index.ts
  - id: reporter-default
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: reporter-live-ink
    resource: ../../packages/reporter/src/LiveInkRenderer.tsx
  - id: reporter-package-json
    resource: ../../packages/reporter/package.json
  - id: reporter-github-log
    resource: ../../packages/reporter/src/githubLog.ts
generated:
  by: okfit/claude-code
  at: 2026-10-01T07:18:02Z
  body_sha256: a34f36ca0a73830a12239610d16655e58005852ae734befee9784e9844101502
---

# @vitest-agent/reporter

## Purpose

`@vitest-agent/reporter` ships the production default `VitestAgentReporterFactory`
— `DefaultVitestAgentReporter`, the factory `@vitest-agent/plugin` wires in
when the user's `reporter` option is unset — and doubles as the reference
package a custom-reporter author reads next to their own code[^reporter-default].
It owns the default reporter outright: mode branching on `consoleMode`,
dispatch through `@vitest-agent/ui`'s shape × outcome matrix, the two
`report`-target file bodies, and the live Ink mount's lifecycle end to end.

## Boundary

Depends on `@vitest-agent/sdk` and `@vitest-agent/ui` as workspace
dependencies, and on `react` + `ink` as full `dependencies` — this package
owns the concrete React instance, where `@vitest-agent/ui` only declares
`react`/`ink` as `peerDependencies` because it renders *with* React without
owning the instance[^reporter-package-json]. `@effected/cli`,
`@effected/env`, `@effected/walker`, and `@effected/glob` are peer (plus dev)
dependencies, the same library pattern `@vitest-agent/ui` uses: this package
builds kit `Doc`s and renders them with `Render`, and imports `Glyphs`, so it
must resolve the same kit instance as ui; `walker` and `glob` are there
because `@effected/cli` requires them as peers. The carrier
`@vitest-agent/plugin` provides all four. It imports no Vitest API: Vitest
lifecycle wiring, the `AgentReporter` class, `ReporterKit` construction, and
routing of `RenderedOutput[]` all belong to
[the plugin module](plugin.md), not here. This package's `render(input, kit)`
is a synchronous, I/O-free function — no Effect requirement crosses the
contract boundary into a custom reporter's code.

## Public surface

`packages/reporter/src/index.ts` is the entire export surface, in three
groups[^reporter-index]:

- **The default reporter** — `DefaultVitestAgentReporter`.
- **Contract type re-exports from the SDK** — `RenderedOutput`, `ReporterKit`,
  `ReporterRenderInput`, `ResolvedReporterConfig`, `VitestAgentReporter`,
  `VitestAgentReporterFactory`, plus the supporting types a custom dispatch
  caller needs (`AgentReport`, `CellOptions`, `ConsoleMode`, `DetailLevel`,
  `DispatchInputs`, `Environment`, `Executor`, `FileCoverageReport`,
  `OutputFormat`, `ProjectSummary`, `RenderState`, `ResolvedThresholds`,
  `RunEvent`, `RunOutcome`, `RunShape`, `TestClassification`, `Transport`,
  `TrendSummary`) — so a custom-reporter author never needs
  `@vitest-agent/sdk` as a direct dependency. See
  [the reporter contract interface](../interfaces/reporter-contract.md).
- **Dispatch helpers** — `buildDispatchInputs`, `resolveCellOptions`,
  `renderAgentStringForReport`, `renderHumanStringForReport`, plus the
  live-mount driver exported as `_createLiveInk` (alias of `createLiveInk`)
  with its `LiveInkRenderer` / `CreateLiveInkOptions` types — internal to the
  default reporter, not normally named by a consumer.

The dispatcher, cells, and reducer that `DefaultVitestAgentReporter` drives
live in `@vitest-agent/ui` and can be imported from that package directly by
a host composing at a different layer.

## Key files

- `src/index.ts` — the public surface described above, plus
  `CURRENT_REPORTER_VERSION`.
- `src/defaultReporter.ts` — `DefaultVitestAgentReporter`.
- `src/LiveInkRenderer.tsx` — `createLiveInk`, the imperative Ink mount and
  its animation clock. Carries this package's only JSX, so
  `packages/reporter/tsconfig.json` sets `"jsx": "react-jsx"`.
- `src/githubLog.ts` — `renderGithubLog`, the `::group::vitest-agent` log
  block, built as a kit `Doc` (a top-level collapsible) and rendered with
  `Render.githubLog`, which neutralizes workflow commands, so a project
  name, a path or the db path can no longer inject one[^reporter-github-log].
  Its per-project line counts a timed-out test as `failed`, unlike the step
  summary's totals table — a known inconsistency kept deliberately.

Both render contexts come from the kit's pure `Render.contextOf` with
`audience: "ci"` (no colour, no links, unbounded width) and `toDisplayPath`
as `displayPath`, since the reporter runs inside Vitest with no Effect CLI
runtime. The log block keeps the `ci` default that neutralizes workflow
commands; the step summary and `summary.md` are files, so their context
sets `neutralizeWorkflowCommands: false`[^reporter-default].

## The default reporter

`DefaultVitestAgentReporter` is invoked once at run start, so a
stream-mode live mount can subscribe to the run-event channel before the
first event arrives[^reporter-default]. Two moments matter:

- **At factory invocation** (`packages/reporter/src/defaultReporter.ts:460`)
  — when `kit.config.consoleMode === "stream"` and `kit.runEvents` is
  defined, the factory subscribes a live Ink mount to the channel.
- **At `render(input, kit)`** (`:464`) — called once at run end with a
  second, health-aware `ReporterKit`. For a console mode that owns stdout it
  folds `input.reports` through the synthesizer and reducer, builds
  `DispatchInputs`, and dispatches through the matrix for one `stdout`
  `RenderedOutput`. In `stream` mode `render` emits no stdout entry — the
  live mount already painted the run. When `kit.config.githubActions` is
  `true` it appends a GitHub Actions summary payload. Two `report`-target
  outputs are always appended, regardless of console mode.

The two-kit model — a neutral run-start kit for factory invocation, a
post-run health-aware kit for `render` — is the reporter contract itself; see
[the reporter contract interface](../interfaces/reporter-contract.md). The
plugin half of the lifecycle (constructing both kits, invoking the factory,
routing `RenderedOutput[]` by target) is documented in
[the plugin module](plugin.md).

## Report files

`render` always appends two `target: "report"` outputs at the end of its
result, independent of console mode — they are the machine-facing artifact,
not a reflection of what the terminal shows[^reporter-default]:

- **`run.json`** — `{ $schema, schemaVersion: 1, generatedAt, reports }`,
  built `satisfies RunReportFile` so a shape change fails to typecheck
  against the published contract.
- **`summary.md`** — the same markdown built for the GitHub step summary.

Every section of that markdown is a kit `Doc` rendered through
`Render.markdown`[^reporter-default]:

- **Totals** — a plain `Doc.table` (`Project`, `Passed`, `Failed`,
  `Timed out`, `Skipped`, `Duration`), with a `Doc.strong("Total")` row
  when there is more than one project. It is not a `Doc.countsTable`,
  which heads its label column with nothing and has no column for a
  formatted duration.
- **Classifications** — a kit table.
- **Coverage** — a table capped at ten rows with a `(+N more not shown)`
  overflow line; each path cell is a `Doc.file`, shown through the
  context's `displayPath` and never linked.
- **Trend** — `Doc.heading` plus `Doc.lines`, so each line but the last
  ends in a GFM hard break (a trailing `\`) and a strict GFM reader
  cannot fold them into one paragraph.

Durations in the GFM summary's per-project table go through
`@vitest-agent/ui`'s `formatDisplayDuration` (the kit's `Fmt.duration`), so
the table and the console print a duration the same way[^reporter-default].
`__test__/summary.golden.test.ts` pins the GFM step summary, `summary.md`,
the `::group::` log block, and the agent-mode stdout byte-for-byte under
`__test__/snapshots/`, so a change to a shared primitive (duration,
percent, glyph) lands as a reviewed snapshot diff.

Writing, scope resolution, filename validation and flushing all live in the
plugin; this package only names a file and hands over a string. See
[the report-files interface](../interfaces/report-files.md).

## The `stream` mount and the animation clock

`stream` mode mounts the agent-shaped `StreamApp` Ink component from
`@vitest-agent/ui`, laid out by run shape. `createLiveInk`
(`packages/reporter/src/LiveInkRenderer.tsx`) owns an animation clock the
spinner and the ticking elapsed-time column both need[^reporter-live-ink]:

- The clock is a `setInterval` that calls `instance.rerender()` so frames
  advance between discrete `RunEvent` arrivals (`:208-216`).
- It starts in the `RunStarted` branch, not on mount — watch mode mounts
  once and runs many times, so a mount-scoped clock would leave reruns
  un-animated (`:252-288`).
- It stops on the terminal event and defensively on teardown, because the
  drain fiber feeding events is never cancelled and the interval must not
  outlive the instance.
- The spinner frame index derives from `Date.now()` (`:177`), not a
  monotonic counter, so it stays correct across watch-mode remounts, and is
  passed to `StreamApp` as a prop rather than entering the event-sourced
  `RenderState`.
- The mount also passes `glyphs: { term: process.env.TERM }` to
  `StreamApp`, read once per renderer, so `TERM=dumb` gets the kit's ASCII
  glyphs and spinner frames in the live view; ui itself never reads
  `process`.

The renderer is event-plus-clock-driven while a run is in progress: discrete
`RunEvent` arrivals advance state, the clock advances frames between them.
See [the end-of-run-rendering limitation](../limitations/end-of-run-rendering.md)
for what this buys and what it does not.

## Building a custom reporter

The contract is a synchronous `render(input, kit) -> RenderedOutput[]`. No
Vitest-API awareness, no I/O, no Effect requirement — a no-op reporter is one
line: `() => ({ render: () => [] })`. A custom factory that wants live
painting subscribes to `kit.runEvents` at factory-invocation time and drives
its own renderer off the stream; a factory that only wants the final frame
ignores `runEvents` and implements `render`. `DefaultVitestAgentReporter` is
the comprehensive worked example for both — it branches on every
`consoleMode`, dispatches through the matrix, and owns the Ink mount — a
strong "follow our system cleanly" reference rather than a minimal starting
point. See [the reporter contract interface](../interfaces/reporter-contract.md).

## Why the separation from `@vitest-agent/ui` stays

`@vitest-agent/ui` is the pure rendering-primitives layer; this package is
the default reporter and the reference package. `ui` has exactly one
consumer today, which on its own would argue for merging the two packages.
The deciding factor against merging is a planned MCP triage-dashboard app: a
React-based MCP app would consume `ui`'s rendering primitives directly, and
keeping `ui` separate avoids a merge-then-resplit churn when that app lands.
See [Decision 34](../decisions/34-plugin-reporter-split.md).

## CURRENT_REPORTER_VERSION

`packages/reporter/src/index.ts:75` exports `CURRENT_REPORTER_VERSION`,
inlined from the package's own `version` field at build time, as public API
for version introspection by downstream tooling. Nothing in this repository
imports it internally — the cross-package lockstep-version check that once
compared it against the plugin's own version constant was removed with the
move to independent per-package releases — but it stays part of the public
surface.

## Choices absorbed here

**Dual output strategy (markdown + JSON).** An LLM agent needs both
human-readable context for reasoning and machine-parseable data for
programmatic analysis. Markdown is natural for LLM reasoning; JSON enables
persistence across runs and a manifest-first read pattern. Each format
serves a distinct purpose the other cannot, which is why `render` always
emits both a console-facing dispatch string and the `run.json` / `summary.md`
report pair regardless of console mode.

**Scoped `Effect.runPromise` in the reporter lifecycle.** Vitest
instantiates the plugin's reporter class — construction is out of this
system's control — so each lifecycle hook that needs Effect services builds
a self-contained effect and runs it with `Effect.runPromise`, providing the
live layer inline rather than reaching for `ManagedRuntime`. The layer is
lightweight (SQLite plus pure services), so per-call construction is
acceptable there and avoids `ManagedRuntime` lifecycle concerns — no
resource leak, no disposal step. This differs from the MCP server, a
long-running process where per-call construction would be wasteful and which
uses `ManagedRuntime` instead. `DefaultVitestAgentReporter`'s own contract
has no Effect requirement at all — the scoped-`Effect.runPromise` pattern
lives on the plugin side of the boundary that invokes this package's
`render`, not inside it. See
[the per-call layer construction limitation](../limitations/per-call-layer-construction.md).

**Per-project reporter instances.** Vitest calls `configureVitest` once per
project, so the plugin constructs one reporter instance per project and
passes a `projectFilter`; each instance filters `testModules` to its own
project rather than the two instances coordinating with each other. This is
plugin-side construction, but it is why `DefaultVitestAgentReporter`'s
factory can assume it is invoked fresh per project without any shared
mutable state of its own.

## Limitations

- [End-of-run rendering](../limitations/end-of-run-rendering.md) — what the
  stream-mode live mount does and does not paint before the run ends.
- [Per-call layer construction](../limitations/per-call-layer-construction.md)
  — the cost/benefit of the scoped-`Effect.runPromise` pattern above.
- [No standalone reporter](../limitations/no-standalone-reporter.md) — this
  package cannot be driven outside a `VitestAgentReporterFactory` invocation.

[^reporter-index]: `packages/reporter/src/index.ts`
[^reporter-default]: `packages/reporter/src/defaultReporter.ts`
[^reporter-live-ink]: `packages/reporter/src/LiveInkRenderer.tsx`
[^reporter-package-json]: `packages/reporter/package.json`
[^reporter-github-log]: `packages/reporter/src/githubLog.ts`
