# vitest-agent-ui

The shared event-sourced renderer for [vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent). Owns the streaming `RunEvent` taxonomy, the pure reducer, two render paths (a markdown-flavored agent string and a React Ink tree), the shape-tailored dispatcher matrix, the preassembled default reporter the plugin wires by default, an Effect `PubSub` channel for live event transport, the synthesizers, and an internal live-Ink mount.

This package is a workspace dependency of `vitest-agent-plugin`, so you do not need to install it directly. Modern pnpm and npm pull it in automatically. Install explicitly only if your package manager skips workspace deps:

```bash
pnpm add -D vitest-agent-ui
```

`react` and `ink` are peer dependencies of this package; both are required (not optional).

## What this package gives the plugin

The plugin imports two internal symbols from `vitest-agent-ui`:

- `_defaultReporter` — the preassembled `VitestAgentReporterFactory` the plugin wires when the user does not pass a `reporter` option. The factory folds the published event stream into `RenderState`, classifies the run shape and outcome, dispatches to the matching cell, and emits one `RenderedOutput` for the run. It branches on `kit.config.consoleMode`: emits the agent string for `"agent"`, emits nothing for `"silent"` / `"passthrough"` / `"ci-annotations"` / `"ink"` (in `"ink"` the live mount owns the visible work).
- `_createLiveInk` — the imperative live-mount driver the plugin starts when `consoleMode === "ink"`. Returns `{ event, snapshot, unmount }`; the plugin advances state on each `RunEvent` and unmounts at end-of-run.

The `_` prefix signals "internal — the plugin handles wiring." Users do not import these.

## Public surface for custom-reporter authors

Custom reporters depend on `vitest-agent-reporter` (the escape-hatch SDK) rather than importing from `vitest-agent-ui` directly. `vitest-agent-reporter` re-exports the dispatcher helpers from here so a custom reporter can reuse the same inputs assembly the preassembled default uses:

| Helper | What it does |
| --- | --- |
| `buildDispatchInputs(reports, kit)` | Assembles a `DispatchInputs` from the per-project `AgentReport[]` and the resolved `ReporterKit`. Pre-computes shape, outcome, project aggregates, trend, and below-target listings so cells stay focused on shape-specific copy |
| `resolveCellOptions(kit, dispatchInputs)` | Resolves the per-cell options from the kit config (color flag, OSC-8 enablement, MCP hint flag, etc.) |
| `dispatch(inputs, opts)` | Routes a `DispatchInputs` to the matching `(shape, outcome)` cell and returns the agent-string render |
| `dispatchInk(inputs, opts)` | Same as `dispatch` but returns the Ink element used by both live and report-time Ink frames |
| `classifyRunShape(state, projects)` | Returns one of `"single-test"`, `"single-file"`, `"single-project"`, `"workspace"` |
| `classifyOutcome(state)` | Returns one of `"all-pass"`, `"some-fail"`, `"threshold-violation"` |
| `buildFooter(inputs, opts)` | Assembles the L1 MCP-tool-pointer footer for a render |
| `dominantClassification(inputs)` | Picks the most actionable failure class so the footer points at the right MCP tool |

The contract types (`RunShape`, `RunOutcome`, `ProjectSummary`, `TrendSummary`, `DispatchInputs`, `CellOptions`) live in `vitest-agent-sdk` and are re-exported by `vitest-agent-reporter` alongside the helpers.

## Replaying a cached run from the CLI

The `vitest-agent show` command threads `vitest-agent-ui`'s report-time render helpers under the hood:

```bash
npx vitest-agent show --project <name> --format auto
# Picks the React Ink view on a TTY; the markdown-flavored agent string otherwise.
```

`--format auto` picks the Ink view for an interactive TTY and the markdown agent string otherwise. Pass `agent`, `human`, or `json` to force a specific output. The same renderer drives the live view during a run, so a captured run replays byte-identically to what the live view showed. Multi-project workspaces render as a single workspace-aggregate frame, not one frame per project.

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme) and the [configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md#console).

## License

[MIT](./LICENSE)
