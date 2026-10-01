# @vitest-agent/reporter

The default reporter package and the reference package for custom-reporter authors. Ships `DefaultVitestAgentReporter` — the production default `VitestAgentReporterFactory` the plugin injects when the user passes no custom `reporter` option — and owns the `stream` live view's lifetime end to end (the mount itself is the kit's `CliUi.live`). Also re-exports the reporter contract types from `@vitest-agent/sdk` and the dispatch helpers from `@vitest-agent/ui`, so a custom-reporter author imports everything from one package and can read a real, complete factory next to their own code. Workspace dependencies are `@vitest-agent/sdk` + `@vitest-agent/ui`; `react` and `ink` are full `dependencies` (this package owns the React instance — it is the concrete consumer of `@vitest-agent/ui`'s react/ink peers). `@effected/cli`, `@effected/env`, `@effected/walker`, and `@effected/glob` are peer (plus dev) dependencies — the same library pattern as `@vitest-agent/ui`, because this package builds kit `Doc`s and imports `Doc` / `Render` / `Glyphs` directly (`walker` and `glob` are `@effected/cli`'s own required peers); the carrier `@vitest-agent/plugin` provides all four. No dependency on `cli` / `mcp`.

## Layout

```text
src/
  index.ts            -- public re-exports + local exports
  defaultReporter.ts  -- DefaultVitestAgentReporter factory + dispatch helpers
  liveView.ts         -- liveViewOptions + startLiveView: CliUi.live over the run-event channel
  githubLog.ts        -- renderGithubLog: the ::group:: log block as a kit Doc

__test__/
  default-reporter.test.ts    -- DefaultVitestAgentReporter end-to-end
  live-view.test.ts           -- CliUiTest.live over liveViewOptions + startLiveView lifetime
```

## Key files

| File | Purpose |
| ---- | ------- |
| `src/index.ts` | Public surface. Exports `DefaultVitestAgentReporter`, the dispatch helpers (`buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`, `renderHumanStringForReport`). Re-exports the contract types (`ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporter`, `VitestAgentReporterFactory`) from `@vitest-agent/sdk`. Exports `CURRENT_REPORTER_VERSION` as public API for version introspection by downstream tooling |
| `src/defaultReporter.ts` | `DefaultVitestAgentReporter` `VitestAgentReporterFactory`. Subscribes to the run-event stream at run start (`onInit`), folds published events into `RenderState`, classifies, dispatches through the 12-cell matrix, and owns mode orchestration: branches on `kit.config.consoleMode` and starts the live view for `stream` mode and returns its `close` as the reporter's `close` (the plugin calls it at Vitest's close). `render(input, kit)` is called once at run end. Every step summary / `summary.md` section is a kit `Doc` rendered through `Render.markdown` under `Render.contextOf({ audience: "ci", displayPath, neutralizeWorkflowCommands: false })` (they are files, not log lines): Totals is `Doc.countsTable(rows, { labelHeader: "Project", durationHeader: "Duration", totalRow: Doc.strong("Total") })` (the total row only with more than one project), Coverage path cells are `Doc.file`, and Trend is `Doc.heading` + `Doc.lines`, so its lines end in GFM hard breaks (a trailing `\`). `summarizeProject` builds each `ProjectSummary` for `buildDispatchInputs`, deriving the per-project `timeoutCount` from timeout-flavored failures (subtracted from `failCount`) so the workspace table attributes timeouts per project. Also exposes the dispatch helpers re-exported by `index.ts` |
| `src/liveView.ts` | `liveViewOptions` (the fold, `StreamApp` drawing, `isStart` / `isTerminal`, the `begins` join-mid-run predicate, `mode: "owned"`, `tickMillis: SPINNER_FRAME_MS`) and `startLiveView(channel, env?)`, which subscribes synchronously, runs `CliUi.live` in a scope it owns, and hands the subscription to the kit (`events: subscription`), and returns `close`: the kit's `LiveHandle.close` (folds every event still queued, commits the last run) then the scope's close. Never relies on `PubSub.shutdown` to end the view (shutdown drops untaken messages). `LiveViewEnv` = `CliEnv.layer()` over `NodeServices` (theme glyphs `auto`, so `TERM=dumb` draws ASCII; interactive only for a human with TTY stdin/stdout and `TERM` not `dumb`, otherwise the final frame prints once). The kit owns mount, tick, height clamp, perf drain, degrade, and teardown |
| `src/githubLog.ts` | `renderGithubLog`: the `::group::vitest-agent` block built entirely as a kit `Doc` (a top-level collapsible) and rendered with `Render.githubLog` under `Render.contextOf({ audience: "ci", displayPath: toDisplayPath })`, so project names, paths, and the db path are workflow-command neutralized |

## Conventions

- **No Vitest-API imports.** This package must not import `vitest` or `vitest/node`. Vitest lifecycle belongs in `@vitest-agent/plugin`.
- **This package owns rendering orchestration.** `DefaultVitestAgentReporter` branches on `consoleMode`, dispatches through the matrix, and owns the live view's lifetime itself (start, `close`). The plugin feeds it a run-event stream and a resolved `ReporterKit`, calls `close` at Vitest's close, and never touches rendering.
- **This package owns the React instance.** `react` and `ink` are full `dependencies` here because `@vitest-agent/reporter` is the concrete consumer of `@vitest-agent/ui`'s peer-declared react/ink. The package has no `.tsx` source (`liveView.ts` builds `StreamApp` with `createElement`), so `tsconfig.json` sets no `jsx` option; add `"jsx": "react-jsx"` there if JSX is ever reintroduced.
- **Reference package for custom reporters.** Users who want different output write their own `VitestAgentReporterFactory` and pass it as the `reporter` option to `AgentPlugin()`. They depend on `@vitest-agent/reporter` to pull the contract types, the dispatch helpers, and `DefaultVitestAgentReporter` as a worked example from one package.
- **Contract types live in the SDK.** `ReporterKit`, `VitestAgentReporterFactory`, `ReporterRenderInput`, and `RenderedOutput` are defined in `packages/sdk/src/contracts/reporter.ts`. This package re-exports them as a convenience; do not redeclare them here.
- **Dispatcher primitives live in the UI.** The reducer, dispatcher matrix, cells, render paths, and the `RunEventChannel` PubSub live in `@vitest-agent/ui`. `DefaultVitestAgentReporter` consumes them; do not duplicate them here.

## When working in this package

- Editing `DefaultVitestAgentReporter`: rendering orchestration (mode branching, live-view lifetime, dispatch wiring) belongs here. Reducer or dispatcher-cell changes belong in `@vitest-agent/ui`; contract changes belong in `@vitest-agent/sdk`; plugin lifecycle wiring belongs in `@vitest-agent/plugin`.
- `render(input, kit)` takes two arguments — the second is a health-aware `ReporterKit` resolved at run end. Keep the two-argument signature in sync with the contract in `packages/sdk/src/contracts/reporter.ts`.
- Adding a re-export: confirm the symbol genuinely belongs in the public custom-reporter surface before adding it. Surface bloat propagates to every downstream consumer.
- Keep `CURRENT_REPORTER_VERSION` exported — it is public API for version introspection by downstream tooling. The cross-package runtime drift check was removed, so nothing imports it internally anymore, but it stays part of this package's surface.

## Design references

- [`../../okf/modules/reporter.md`](../../okf/modules/reporter.md)
  Load for the default-reporter role, the four-layer model, and the reference-package design.
- [`../../okf/modules/ui.md`](../../okf/modules/ui.md)
  Load when working on the dispatcher matrix, cells, or render paths consumed by `DefaultVitestAgentReporter`.
- [`../../okf/interfaces/reporter-contract.md`](../../okf/interfaces/reporter-contract.md)
  Load when working with the public reporter contract types (`ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporterFactory`).
- [`../../okf/decisions/34-plugin-reporter-split.md`](../../okf/decisions/34-plugin-reporter-split.md), [`../../okf/decisions/41-shape-tailored-dispatcher-matrix.md`](../../okf/decisions/41-shape-tailored-dispatcher-matrix.md)
  Load for rationale on the plugin/reporter split and the shape-tailored dispatcher matrix.
