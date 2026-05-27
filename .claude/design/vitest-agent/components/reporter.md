---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-23
last-synced: 2026-05-23
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ./plugin.md
  - ./sdk.md
  - ./ui.md
dependencies: []
---

# Reporter package (`vitest-agent-reporter`)

The default reporter for the `vitest-agent` plugin — and the canonical worked example for authors building their own. This package owns the production default reporter outright. A custom-reporter author depends on this one package, reads a real complete `VitestAgentReporterFactory` next to their own code, and gets the contract types plus the dispatch helpers from a single import.

**npm name:** `vitest-agent-reporter`
**Location:** `packages/reporter/`
**Internal dependencies:** `vitest-agent-sdk`, `vitest-agent-ui`
**External dependencies:** `react`, `ink` (full deps — the package owns the React instance the `ui` primitives render against)

The plugin declares this package as a regular workspace `dependency` (pinned at `workspace:*`), not a peer, so version-drift detection has a stable handle. This package declares `react` and `ink` as full dependencies: `vitest-agent-ui` declares them as `peerDependencies` because it renders *with* React/Ink but does not own the instance, and `reporter` is the concrete consumer of `ui`, so it provides the peer. The plugin does not touch JSX.

For the contract types (`VitestAgentReporterFactory`, `VitestAgentReporter`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `ResolvedReporterConfig`) see [./sdk.md](./sdk.md). For how the plugin invokes the factory and feeds the run-event stream see [./plugin.md](./plugin.md). For the dispatcher matrix and cell library this package drives see [./ui.md](./ui.md).

---

## What this package exports

`packages/reporter/src/index.ts` is the entire public surface. Three groups:

- **The default reporter** — `DefaultVitestAgentReporter`, the preassembled `VitestAgentReporterFactory` the plugin wires as its built-in when the user's `reporter` option is unset.
- **Contract type re-exports from the SDK** — `RenderedOutput`, `ReporterKit`, `ReporterRenderInput`, `ResolvedReporterConfig`, `VitestAgentReporter`, `VitestAgentReporterFactory`. A custom-reporter author imports everything they need from `vitest-agent-reporter` without adding `vitest-agent-sdk` as a direct dependency.
- **Dispatch helpers** — `buildDispatchInputs(state, input, overrides?)`, `resolveCellOptions(kit)`, `renderAgentStringForReport(report)` and `renderHumanStringForReport(report, options?)`. A custom factory that wants to reuse the dispatcher pipeline composes them. The live-mount driver is exported as `_createLiveInk` (alias of `createLiveInk`) plus the `LiveInkRenderer` / `CreateLiveInkOptions` types; it is internal to the default reporter and consumers do not normally name it.

The dispatcher itself, the cells and the reducer live in `vitest-agent-ui` and can be imported from that package directly for hosts composing at a different layer.

`LiveInkRenderer.tsx` (`packages/reporter/src/`) carries the JSX in this package, so `packages/reporter/rslib.config.ts` carries the SWC automatic-runtime plugin and `tsconfig.json` sets `"jsx": "react-jsx"`. Its tests live at `packages/reporter/__test__/` (`default-reporter.test.ts`, `live-ink-renderer.test.ts`).

---

## The default reporter

`packages/reporter/src/defaultReporter.ts` exports `DefaultVitestAgentReporter`. The factory is invoked once at **run start** (by the plugin's `initReporters()` in `onInit`), so a live-painting reporter can subscribe to the run-event channel before the first event. Two things happen:

- **At factory invocation** — when `kit.config.consoleMode === "stream"` and `kit.runEvents` is present, the factory subscribes a live Ink mount to the run-event channel and forks a drain fiber that feeds `createLiveInk`. The reporter owns the Ink mount lifecycle end to end: mount, rerender per event, unmount on `RunFinished`. See D34 / D41 in [../decisions.md](../decisions.md).
- **At `render(input, kit)`** — called once at run end with a second, health-aware `ReporterKit`. For `consoleMode === "agent"` it folds `input.reports` through the synthesizer and reducer, builds `DispatchInputs`, calls `dispatch(inputs, opts)` and returns one `RenderedOutput` with `target: "stdout"`. For `silent`, `passthrough`, `stream` and `ci-annotations` it emits no stdout output (the `stream` live painting already happened off the stream). When `kit.config.githubActions` is `true` it emits an additional `target: "github-summary"` `RenderedOutput` regardless of console mode.

The two-kit model is part of the contract: `render(input, kit)` takes a second argument because the factory kit is resolved at run start (neutral run health) and the render kit is resolved at run end (post-run `detail`). See `VitestAgentReporter` in `packages/sdk/src/contracts/reporter.ts`.

---

## The `stream` mount and the animation clock

`stream` mode mounts the agent-shaped, lifecycle-aware `StreamApp` Ink component from `vitest-agent-ui`. `StreamApp` reads the same `RenderState` the reducer produces and lays it out by run shape (one row per project / module / test); see [./ui.md](./ui.md) for the component.

`createLiveInk` in `packages/reporter/src/LiveInkRenderer.tsx` owns an **animation clock** the spinner and the ticking elapsed-time column both need. The mechanics:

- The clock is a `setInterval` (~80ms) that calls `instance.rerender()`, so frames advance between discrete `RunEvent` arrivals.
- It starts in the `RunStarted` branch, **not on mount** — watch mode mounts once and runs many times, so a mount-scoped clock would leave reruns un-animated.
- It stops on `RunFinished` and defensively in `tearDown` / `unmount`, because the forked drain fiber feeding events is never cancelled and the interval must not outlive the instance.
- The spinner frame index derives from wall-clock time (`Date.now()`), not a monotonic counter, so it stays correct across watch-mode remounts. The index is passed to `StreamApp` as a prop — it is presentation state and never enters the event-sourced `RenderState`.

The renderer is event-plus-clock-driven while a run is in progress: discrete `RunEvent` arrivals advance state, the clock advances frames between them.

---

## Building a custom reporter

The contract is a synchronous `render(input, kit) -> RenderedOutput[]`. No Vitest-API awareness, no I/O, no Effect requirements. A no-op reporter is one line: `() => ({ render: () => [] })`.

A custom factory that wants live painting subscribes to `kit.runEvents` at factory-invocation time and drives its own renderer off the stream; a factory that only wants the final frame ignores `runEvents` and implements `render`. `DefaultVitestAgentReporter` is the comprehensive worked example for both — it branches on every `consoleMode`, dispatches through the 12-cell matrix and owns the Ink mount. It is a strong "follow our system cleanly" reference rather than a minimal starting point.

---

## Why the separation from `vitest-agent-ui` stays

`vitest-agent-ui` is the pure rendering-primitives layer; `vitest-agent-reporter` is the default reporter and the reference package. `ui` has exactly one consumer (`reporter`), which on its own would argue for merging the two. The deciding factor against merging is the planned MCP triage-dashboard app — a React-based MCP app would consume `ui`'s rendering primitives directly, and keeping `ui` separate avoids a merge-then-resplit churn when that app lands. See D34 / D41 in [../decisions.md](../decisions.md).

## CURRENT_REPORTER_VERSION

`packages/reporter/src/index.ts` exports `CURRENT_REPORTER_VERSION`
(inlined from `process.env.__PACKAGE_VERSION__` via the package's
`rslib.config.ts` `define`). The plugin imports it and compares
against `CURRENT_PLUGIN_VERSION` at the top of the `AgentPlugin()`
factory to surface cross-package drift on stderr — see
[./plugin.md](./plugin.md) and D36 in [../decisions.md](../decisions.md).
The package-local
`packages/reporter/__test__/version-constant.test.ts` imports the
constant through dist/dev (so it sees the substituted literal) and
asserts it equals the package's `package.json#version`.
