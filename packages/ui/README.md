# vitest-agent-ui

The pure rendering-primitives library for [vitest-agent](https://github.com/spencerbeggs/vitest-agent). Owns the streaming `RunEvent` taxonomy, the pure reducer, two render paths (a markdown-flavored agent string and a React Ink tree), the shape-tailored dispatcher matrix, an Effect `PubSub` channel for live event transport, and the synthesizers. Knows nothing about the reporter lifecycle — the default reporter (`DefaultVitestAgentReporter`) and the Ink live-mount driver live in `vitest-agent-reporter`.

This package is a transitive dependency of `vitest-agent-plugin` (through `vitest-agent-reporter`), so you do not need to install it directly unless you are authoring a custom dispatcher cell or extending the renderer.

`react` and `ink` are peer dependencies of this package; both are required (not optional). `vitest-agent-reporter` satisfies these peers — it is the concrete consumer of `vitest-agent-ui`'s react/ink surface.

## What this package gives vitest-agent-reporter

`vitest-agent-reporter` imports the dispatcher matrix, render paths, and synthesizers from this package to power `DefaultVitestAgentReporter`. The primitives it consumes:

- `dispatch` / `dispatchInk` / `dispatcherTable` — routes a `DispatchInputs` to the matching `(shape, outcome)` cell.
- `classifyRunShape` / `classifyOutcome` — classify the reduced state into a shape and outcome.
- `reduceRenderState` / `reduceRenderStateAll` — fold a `RunEvent` stream into a `RenderState`.
- `synthesizeFromAgentReport` — bridge from a stored `AgentReport` to the `RunEvent` taxonomy.
- `StreamApp` — the root React Ink component for the live `stream`-mode frames.

`vitest-agent-reporter` owns the live-mount lifecycle (`_createLiveInk`) and the default reporter factory (`DefaultVitestAgentReporter`). `vitest-agent-plugin` no longer imports anything from this package directly.

## Public surface for custom-reporter authors

Custom reporters depend on `vitest-agent-reporter`, not `vitest-agent-ui` directly. The reporter package re-exports the `buildDispatchInputs` and `resolveCellOptions` helpers alongside the contract types, so custom authors get everything from one import. If you need lower-level dispatcher primitives, import them from `vitest-agent-ui`:

| Export | What it does |
| --- | --- |
| `dispatch(inputs, opts)` | Routes a `DispatchInputs` to the matching `(shape, outcome)` cell and returns the agent-string render |
| `dispatchInk(inputs, opts)` | Same as `dispatch` but returns the Ink element for live and report-time Ink frames |
| `classifyRunShape(state, projects)` | Returns one of `"single-test"`, `"single-file"`, `"single-project"`, `"workspace"` |
| `classifyOutcome(state)` | Returns one of `"all-pass"`, `"some-fail"`, `"threshold-violation"` |
| `buildFooter(inputs, opts)` | Assembles the L1 MCP-tool-pointer footer for a render |
| `dominantClassification(inputs)` | Picks the most actionable failure class so the footer points at the right MCP tool |
| `reduceRenderState(state, event)` | Fold one `RunEvent` into a `RenderState` |
| `reduceRenderStateAll(events)` | Fold a full event sequence into a terminal `RenderState` |

The contract types (`RunShape`, `RunOutcome`, `ProjectSummary`, `TrendSummary`, `DispatchInputs`, `CellOptions`) live in `vitest-agent-sdk` and are re-exported by both `vitest-agent-ui` and `vitest-agent-reporter`.

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme) and the [configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md#console). For the default reporter and the Ink live-mount driver, see the [vitest-agent-reporter README](https://github.com/spencerbeggs/vitest-agent/blob/main/packages/reporter/README.md).

## License

[MIT](./LICENSE)
