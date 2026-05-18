# vitest-agent-reporter

The default reporter package and the reference package for custom-reporter authors. Ships `DefaultVitestAgentReporter` — the production default `VitestAgentReporterFactory` the plugin injects when the user passes no custom `reporter` option — and owns the Ink live-mount lifecycle end to end. Also re-exports the reporter contract types from `vitest-agent-sdk` and the dispatch helpers from `vitest-agent-ui`, so a custom-reporter author imports everything from one package and can read a real, complete factory next to their own code. Workspace dependencies are `vitest-agent-sdk` + `vitest-agent-ui`; `react` and `ink` are full `dependencies` (this package owns the React instance — it is the concrete consumer of `vitest-agent-ui`'s react/ink peers). No `cli` / `mcp` peers.

## Layout

```text
src/
  index.ts            -- public re-exports + local exports
  defaultReporter.ts  -- DefaultVitestAgentReporter factory + dispatch helpers
  LiveInkRenderer.tsx -- _createLiveInk imperative Ink mount + LiveInkRenderer type

__test__/
  default-reporter.test.ts    -- DefaultVitestAgentReporter end-to-end
  live-ink-renderer.test.ts   -- mount orchestration
```

## Key files

| File | Purpose |
| ---- | ------- |
| `src/index.ts` | Public surface. Exports `DefaultVitestAgentReporter`, the dispatch helpers (`buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`, `renderHumanStringForReport`), the live renderer (`_createLiveInk` + `LiveInkRenderer` type). Re-exports the contract types (`ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporter`, `VitestAgentReporterFactory`) from `vitest-agent-sdk`. Exports `CURRENT_REPORTER_VERSION` for the cross-package drift check |
| `src/defaultReporter.ts` | `DefaultVitestAgentReporter` `VitestAgentReporterFactory`. Subscribes to the run-event stream at run start (`onInit`), folds published events into `RenderState`, classifies, dispatches through the 12-cell matrix, and owns mode orchestration: branches on `kit.config.consoleMode` and owns the Ink live-mount lifecycle (mount / rerender / unmount) for `ink` mode. `render(input, kit)` is called once at run end. Also exposes the dispatch helpers re-exported by `index.ts` |
| `src/LiveInkRenderer.tsx` | `_createLiveInk` imperative orchestration. `event(e)` advances state and rerenders, `unmount()` is idempotent, `snapshot()` exposes the latest reduced state. Mount failures degrade silently with a stderr warning. Driven by `DefaultVitestAgentReporter`, not by the plugin |

## Conventions

- **No Vitest-API imports.** This package must not import `vitest` or `vitest/node`. Vitest lifecycle belongs in `vitest-agent-plugin`.
- **This package owns rendering orchestration.** `DefaultVitestAgentReporter` branches on `consoleMode`, dispatches through the matrix, and drives the Ink mount lifecycle itself. The plugin feeds it a run-event stream and a resolved `ReporterKit` and never touches rendering.
- **This package owns the React instance.** `react` and `ink` are full `dependencies` here because `vitest-agent-reporter` is the concrete consumer of `vitest-agent-ui`'s peer-declared react/ink. JSX builds via the SWC automatic-runtime plugin in `rslib.config.ts` and `"jsx": "react-jsx"` in `tsconfig.json` — keep both in place when editing `LiveInkRenderer.tsx`.
- **Reference package for custom reporters.** Users who want different output write their own `VitestAgentReporterFactory` and pass it as the `reporter` option to `AgentPlugin()`. They depend on `vitest-agent-reporter` to pull the contract types, the dispatch helpers, and `DefaultVitestAgentReporter` as a worked example from one package.
- **Contract types live in the SDK.** `ReporterKit`, `VitestAgentReporterFactory`, `ReporterRenderInput`, and `RenderedOutput` are defined in `packages/sdk/src/contracts/reporter.ts`. This package re-exports them as a convenience; do not redeclare them here.
- **Dispatcher primitives live in the UI.** The reducer, dispatcher matrix, cells, render paths, and the `RunEventChannel` PubSub live in `vitest-agent-ui`. `DefaultVitestAgentReporter` consumes them; do not duplicate them here.

## When working in this package

- Editing `DefaultVitestAgentReporter`: rendering orchestration (mode branching, Ink mount lifecycle, dispatch wiring) belongs here. Reducer or dispatcher-cell changes belong in `vitest-agent-ui`; contract changes belong in `vitest-agent-sdk`; plugin lifecycle wiring belongs in `vitest-agent-plugin`.
- `render(input, kit)` takes two arguments — the second is a health-aware `ReporterKit` resolved at run end. Keep the two-argument signature in sync with the contract in `packages/sdk/src/contracts/reporter.ts`.
- Adding a re-export: confirm the symbol genuinely belongs in the public custom-reporter surface before adding it. Surface bloat propagates to every downstream consumer.
- Keep `CURRENT_REPORTER_VERSION` wired — the plugin's drift check compares against it, and this package is now its correct home.

## Design references

- `@.claude/design/vitest-agent/components/reporter.md`
  Load for the default-reporter role, the four-layer model, and the reference-package design.
- `@.claude/design/vitest-agent/components/ui.md`
  Load when working on the dispatcher matrix, cells, or render paths consumed by `DefaultVitestAgentReporter`.
- `@.claude/design/vitest-agent/schemas.md`
  Load when working with the public reporter contract types (`ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporterFactory`).
- `@.claude/design/vitest-agent/decisions.md`
  Load for rationale on the plugin/reporter split and the T6 dispatcher matrix.
