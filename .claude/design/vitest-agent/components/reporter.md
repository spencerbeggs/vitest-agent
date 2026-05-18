---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-18
last-synced: 2026-05-18
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

The default reporter for the `vitest-agent` plugin — and the canonical worked example for authors building their own. After the reporter-package restructure (`feat/2.0-reporter-restructure`) this package owns the production default reporter outright; it is no longer the empty re-export shell it was after T6. A custom-reporter author depends on this one package, reads a real complete `VitestAgentReporterFactory` next to their own code, and gets the contract types plus the dispatch helpers from a single import.

**npm name:** `vitest-agent-reporter`
**Location:** `packages/reporter/`
**Internal dependencies:** `vitest-agent-sdk`, `vitest-agent-ui`
**External dependencies:** `react`, `ink` (full deps — the package owns the React instance the `ui` primitives render against)

The plugin declares this package as a regular workspace `dependency` (pinned at `workspace:*`), not a peer, so version-drift detection (T12) has a stable handle. The restructure dropped the redundant `vitest-agent-cli` + `vitest-agent-mcp` peers — a default-reporter package has no reason to require the CLI or MCP server. `react` and `ink` moved here from `vitest-agent-plugin`: `vitest-agent-ui` declares them as `peerDependencies` because it renders *with* React/Ink but does not own the instance, and `reporter` is now the concrete consumer of `ui`, so it provides the peer. The plugin no longer touches JSX.

For the contract types (`VitestAgentReporterFactory`, `VitestAgentReporter`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `ResolvedReporterConfig`) see [./sdk.md](./sdk.md). For how the plugin invokes the factory and feeds the run-event stream see [./plugin.md](./plugin.md). For the dispatcher matrix and cell library this package drives see [./ui.md](./ui.md).

---

## What this package exports

`packages/reporter/src/index.ts` is the entire public surface. Three groups:

- **The default reporter** — `DefaultVitestAgentReporter`, the preassembled `VitestAgentReporterFactory` the plugin wires as its built-in when the user's `reporter` option is unset. Promoted on the restructure from the former internal `_defaultReporter` (underscore-prefixed) name in `vitest-agent-ui` to a first-class public name; the reporter package is built to be the reference package, so its default belongs as a documented export.
- **Contract type re-exports from the SDK** — `RenderedOutput`, `ReporterKit`, `ReporterRenderInput`, `ResolvedReporterConfig`, `VitestAgentReporter`, `VitestAgentReporterFactory`. A custom-reporter author imports everything they need from `vitest-agent-reporter` without adding `vitest-agent-sdk` as a direct dependency.
- **Dispatch helpers** — `buildDispatchInputs(state, input, overrides?)`, `resolveCellOptions(kit)`, `renderAgentStringForReport(report)` and `renderHumanStringForReport(report, options?)`. These moved here from `vitest-agent-ui` with the default reporter — a custom factory that wants to reuse the dispatcher pipeline composes them. The live-mount driver is exported as `_createLiveInk` (alias of `createLiveInk`) plus the `LiveInkRenderer` / `CreateLiveInkOptions` types; it is internal to the default reporter and consumers do not normally name it.

The dispatcher itself, the cells and the reducer live in `vitest-agent-ui` and can be imported from that package directly for hosts composing at a different layer.

---

## What moved here (the restructure)

`vitest-agent-ui/src/factory/` held exactly two files; both moved into `packages/reporter/src/`:

- `defaultReporter.ts` — the `consoleMode`-branching factory plus the `buildDispatchInputs` / `resolveCellOptions` / `renderAgentStringForReport` / `renderHumanStringForReport` helpers. It imports the `ui` primitives from the `vitest-agent-ui` package (not relative paths).
- `LiveInkRenderer.tsx` — the live Ink mount driver (`createLiveInk` and the `LiveInkRenderer` type).

The matching `factory/` tests moved to `packages/reporter/__test__/` (`default-reporter.test.ts`, `live-ink-renderer.test.ts`). `LiveInkRenderer.tsx` brings JSX into this package for the first time, so `packages/reporter/rslib.config.ts` carries the SWC automatic-runtime plugin and `tsconfig.json` sets `"jsx": "react-jsx"`.

---

## The default reporter

`packages/reporter/src/defaultReporter.ts` exports `DefaultVitestAgentReporter`. The factory is invoked once at **run start** (by the plugin's `initReporters()` in `onInit`), so a live-painting reporter can subscribe to the run-event channel before the first event. Two things happen:

- **At factory invocation** — when `kit.config.consoleMode === "ink"` and `kit.runEvents` is present, the factory subscribes a live Ink mount to the run-event channel and forks a drain fiber that feeds `createLiveInk`. The reporter owns the Ink mount lifecycle end to end: mount, rerender per event, unmount on `RunFinished`. This is the orchestration that formerly lived in `plugin/src/reporter.ts` (the former open decision §8.2 — see D34 / D41).
- **At `render(input, kit)`** — called once at run end with a second, health-aware `ReporterKit`. For `consoleMode === "agent"` it folds `input.reports` through the synthesizer and reducer, builds `DispatchInputs`, calls `dispatch(inputs, opts)` and returns one `RenderedOutput` with `target: "stdout"`. For `silent`, `passthrough`, `ink` and `ci-annotations` it emits no stdout output (the `ink` live painting already happened off the stream). When `kit.config.githubActions` is `true` it emits an additional `target: "github-summary"` `RenderedOutput` regardless of console mode.

The two-kit model is part of the contract: `render(input, kit)` takes a second argument because the factory kit is resolved at run start (neutral run health) and the render kit is resolved at run end (post-run `detail`). See `VitestAgentReporter` in `packages/sdk/src/contracts/reporter.ts`.

---

## Building a custom reporter

The contract is a synchronous `render(input, kit) -> RenderedOutput[]`. No Vitest-API awareness, no I/O, no Effect requirements. A no-op reporter is one line: `() => ({ render: () => [] })`.

A custom factory that wants live painting subscribes to `kit.runEvents` at factory-invocation time and drives its own renderer off the stream; a factory that only wants the final frame ignores `runEvents` and implements `render`. `DefaultVitestAgentReporter` is the comprehensive worked example for both — it branches on every `consoleMode`, dispatches through the 12-cell matrix and owns the Ink mount. It is a strong "follow our system cleanly" reference but not a minimal starting point (open decision §8.1).

---

## Why the separation from `vitest-agent-ui` stays

`vitest-agent-ui` is the pure rendering-primitives layer; `vitest-agent-reporter` is the default reporter and the reference package. After the restructure `ui` has exactly one consumer (`reporter`), which on its own would argue for merging the two. The deciding factor against merging is the planned MCP triage-dashboard app — a React-based MCP app would consume `ui`'s rendering primitives directly, and keeping `ui` separate now avoids a merge-then-resplit churn when that app lands. See D34 / D41 in [../decisions.md](../decisions.md).

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
