---
"vitest-agent-sdk": major
"vitest-agent-plugin": major
"vitest-agent-reporter": major
"vitest-agent-cli": major
"vitest-agent-mcp": major
"vitest-agent-ui": major
---

## Breaking Changes

### vitest-agent-ui public surface replaced

The previous renderer-facing exports are removed. Gone are the event-sourced reporter factory and its options type, the live Ink renderer factory and its options type, the live renderer class, the one-shot render-run helper plus its from-state variant, and the render-run mode and options types.

The new public surface is a preassembled default reporter (the value the plugin wires automatically), the dispatch-input builder, the cell-options resolver, and the per-report convenience helpers for agent-string and human-string output.

It also exposes the dispatcher entry points: single dispatch, Ink dispatch, the dispatcher table, the run-shape and outcome classifiers, the footer builder, and the dominant-classification helper. The dispatcher contract types are re-exported from the SDK so every package reads the same definitions.

### vitest-agent-reporter is now a re-export bundle

The package no longer ships any built-in reporters. All previously-named factories are deleted: the default, markdown, terminal, silent, CI-annotations, GitHub-summary, and JSON variants.

The package is reduced to a one-stop import surface for custom-reporter authors: the contract types from the SDK plus the dispatch helpers from the UI. Custom factories build their own reporters on top of those primitives.

### vitest-agent-plugin default reporter and live-event behavior

The reporter option on the plugin factory now defaults to the new built-in. The live event tap is forwarded for every console mode, not just the Ink mode it was previously gated to.

A throwing user tap is caught and logged to stderr so a buggy live subscriber no longer breaks persistence. The plugin also adds vitest-agent-ui as a workspace dependency so consumers do not install the UI package directly.

### vitest-agent-cli show command renders one aggregate frame

The show subcommand now emits a single workspace-aggregate frame for multi-project runs instead of one frame per project. The formatter behind it is now async.

## Features

### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

### L1 MCP tool-pointer footer

Every dispatched render appends a footer that points at the MCP tool best suited to the agent's next action.

All-pass runs with a coverage gap surface the per-file coverage tool. Some-fail runs surface the test-errors tool together with the failure-signature lookup tool when the failure is classified as new or persistent, or the failure-signature lookup tool alone when the failure is flaky.

Threshold-violation runs surface the test-coverage tool.

### Dispatcher contract types in vitest-agent-sdk

New contract types live under the dispatcher contracts module in the SDK: the run-shape and run-outcome enums, a project-summary record, a trend-summary record, the dispatch-input type passed to every cell, and a cell-options record covering optional renderer flags.

The SDK re-exports these from its root so plugin, reporter, UI, and CLI all read the same definitions.

### Per-report convenience helpers

Two new helpers on vitest-agent-ui let one-shot consumers render a single agent report into either an agent-oriented string or a human-oriented string without standing up a full reporter kit. CLI replay paths and custom dashboards use these instead of constructing a transient kit.

### Simpler vitest config

The canonical vitest config no longer imports the event-sourced reporter factory or the live Ink factory. Users wire the plugin with the console matrix and the coverage targets, and the plugin handles the reporter and the live mount internally.

## Maintenance

The MCP package is not directly touched by this workstream but receives a major bump to keep the six runtime packages aligned on the lockstep release.
