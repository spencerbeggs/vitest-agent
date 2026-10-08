---
type: Decision
title: Ink Half behind a ui Subpath, with Lazy Reporter Views
description: The shape-tailored dispatcher matrix keeps its 4×3 routing, footer and single event stream, but a Cell is now the agent string only. The Ink half moves to a separate inkDispatcherTable behind @vitest-agent/ui/ink, and the reporter reaches it only through two lazy-loaded view modules, so importing the reporter or the ui root loads no React or Ink.
status: stable
supersedes: 41-shape-tailored-dispatcher-matrix.md
tags: [architecture, bundle, performance, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: a140772f2bb216545c6caaacae8b8b2be7e2785f0c600041d51aea8f0dc6c69d
sources:
  - id: issue-562
    resource: https://github.com/spencerbeggs/vitest-agent/issues/562
  - id: ui-cell-types
    resource: ../../packages/ui/src/dispatcher/cell-types.ts
  - id: ui-dispatch
    resource: ../../packages/ui/src/dispatcher/dispatch.ts
  - id: ui-ink-dispatch
    resource: ../../packages/ui/src/ink/dispatch-ink.ts
  - id: ui-ink-entry
    resource: ../../packages/ui/src/ink/index.ts
  - id: ui-boundaries
    resource: ../../packages/ui/__test__/boundaries.test.ts
  - id: reporter-live-view
    resource: ../../packages/reporter/src/liveView.ts
  - id: reporter-stream-view
    resource: ../../packages/reporter/src/streamView.ts
  - id: reporter-human-report
    resource: ../../packages/reporter/src/humanReport.ts
  - id: reporter-default-reporter
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: reporter-boundaries
    resource: ../../packages/reporter/__test__/boundaries.test.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
verified:
  - by: human:spencer
    at: 2026-10-08T03:57:59Z
---

# Ink Half behind a ui Subpath, with Lazy Reporter Views

## Context

[Decision 41](./41-shape-tailored-dispatcher-matrix.md) chose a 4×3
`(RunShape × RunOutcome)` dispatcher matrix fed from one `PubSub<RunEvent>`
channel. Each `Cell` carried two halves on one object: an `agent` string
renderer and an `ink` React-element renderer. That put every cell module,
and so the `@vitest-agent/ui` root, on the React and Ink import graph. The
reporter imported `ink` and `react` statically as well.

Most runs never draw an Ink frame. An agent run, a CI run and a piped run
all print the agent string or the plain final document. Issue 562 measured
what they paid anyway: importing `@vitest-agent/reporter` loaded about a
thousand modules, 76 of them React or Ink, and the ui root loaded about the
same ([Measurement: reporter and ui import module
counts](../measurements/reporter-import-module-counts.md)). The reporter
module had earlier considered and declined `CliUi.lazyView` from
`@effected/cli/ui`. The reason was that ui's single entry loaded Ink
whatever the reporter deferred.

## Decision

**The matrix, the stream and the footer are unchanged from Decision 41.**
The plugin owns one `PubSub<RunEvent>` channel on `ReporterKit.runEvents`,
and `onRunEvent` is a parallel read-only tap that is not gated by console
mode. Behind the `wantsRunEvents()` gate, event construction is skipped
when nothing consumes the stream.[^plugin-reporter] `classifyRunShape` and
`classifyOutcome` pick one of twelve cells with a total lookup and no
default. `single-test × threshold-violation` is a documented no-op.
`buildFooter` appends the MCP tool pointer, and `dominantClassification`
picks the classification it keys on. The reporter factory runs at
`onInit` and `render` receives a run-end kit.

**A `Cell` is the agent half only.** `Cell` in the ui root is
`{ agent: AgentCellFn }`, and `dispatcherTable` / `dispatch` live at the
root.[^ui-cell-types][^ui-dispatch] The Ink half is a second table,
`inkDispatcherTable`, keyed by the same matrix, with `dispatchInk` and
the `InkCellFn` type. All three live in `@vitest-agent/ui/ink` with every
Ink component (`StreamApp` and its leaf components).[^ui-ink-dispatch][^ui-ink-entry]
Each Ink cell is derived from the matching agent cell: it paints the
agent string as Ink `<Text>` rows. The no-op cell's Ink entry is
`undefined`, and the caller falls back to the agent string. The spinner
frames, which are pure, stay at the root (`src/spinner.ts`). `ink` and
`react` are now optional peer dependencies of `@vitest-agent/ui`, because
only the subpath needs them.

**The ui root never reaches Ink, by construction.**
`packages/ui/__test__/boundaries.test.ts` forbids `ink`, `react` (type-only
imports included) and any module under `src/ink/` everywhere outside
`src/ink/`.[^ui-boundaries]

**The reporter reaches the Ink half only through two lazy-loaded
modules.** The `stream` live view's drawing lives in `streamView.ts`.
`liveView.ts` hands it to the kit as
`CliUi.lazyView(() => import("./streamView.js"))`, so React and Ink load
when a run first mounts its frame.[^reporter-live-view][^reporter-stream-view]
The report-time human render (`renderToString` inside the kit's
`UiProvider`) lives in `humanReport.ts`. `renderHumanStringForReport`
loads it with `await import("./humanReport.js")`.[^reporter-human-report][^reporter-default-reporter]
These two call sites and `packages/mcp/src/main.ts` are the family's
sanctioned dynamic imports. `packages/reporter/__test__/boundaries.test.ts`
pins the pair. Only `streamView.ts` and `humanReport.ts` may import `ink`,
`react` or `@vitest-agent/ui/ink`. Only `liveView.ts` and
`defaultReporter.ts` may contain `import(`. Nothing may import either view
module statically.[^reporter-boundaries]

## Alternatives rejected

- **Split ui but keep the reporter's static `ink` / `react` imports.**
  The reporter is what the plugin loads on every run. Leaving it eager
  would keep the 76 React and Ink modules on every agent and CI run, which
  is the cost issue 562 set out to remove.
- **`CliUi.lazyView` without the ui split.** This is the option the reporter
  module had already declined: the view module would be lazy, but its
  imports from the ui root would still load Ink.

## Consequences

- An Ink cell can no longer drift from its agent cell about which
  `(shape, outcome)` it renders. It is built from that agent cell.
  Decision 41's guarantee holds by derivation instead of by co-location.
- Adding a run shape or outcome means extending the two enums in
  `packages/sdk/src/contracts/dispatcher.ts`, adding the agent cells to
  `dispatcherTable`, and adding the matching entries to
  `inkDispatcherTable`.
- Removing `.ink` from the root `Cell` and moving the Ink exports to a
  subpath breaks ui's public surface for anyone who imported them from
  the root, so it ships as a breaking change with a changeset.
- A third dynamic import anywhere in the family fails a boundary test. A
  contributor adding one has to change the allowlist and say why.
- The human report-time render now lays out at the terminal's width
  (`TerminalEnv.width(80)`: stdout's columns, then `COLUMNS`, then 80)
  rather than a fixed 80, because `humanReport.ts` reads `TerminalEnv`
  from the same environment layer as the live view (issue 546).

[^plugin-reporter]: `../../packages/plugin/src/reporter.ts`
[^ui-cell-types]: `../../packages/ui/src/dispatcher/cell-types.ts`
[^ui-dispatch]: `../../packages/ui/src/dispatcher/dispatch.ts`
[^ui-ink-dispatch]: `../../packages/ui/src/ink/dispatch-ink.ts`
[^ui-ink-entry]: `../../packages/ui/src/ink/index.ts`
[^ui-boundaries]: `../../packages/ui/__test__/boundaries.test.ts`
[^reporter-live-view]: `../../packages/reporter/src/liveView.ts`
[^reporter-stream-view]: `../../packages/reporter/src/streamView.ts`
[^reporter-human-report]: `../../packages/reporter/src/humanReport.ts`
[^reporter-default-reporter]: `../../packages/reporter/src/defaultReporter.ts`
[^reporter-boundaries]: `../../packages/reporter/__test__/boundaries.test.ts`

## Related

- [DataModel: dispatcher-matrix](../models/dispatcher-matrix.md)
- [Module: ui](../modules/ui.md)
- [Module: reporter](../modules/reporter.md)
- [Convention: imports](../conventions/imports.md)
- [Invariant: package boundaries](../invariants/package-boundaries.md)
