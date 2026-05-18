---
"vitest-agent-reporter": major
"vitest-agent-ui": major
"vitest-agent-plugin": major
---

## Breaking Changes

### The default reporter moves into `vitest-agent-reporter`

The default reporter and the live Ink renderer move out of
`vitest-agent-ui/src/factory/` into `vitest-agent-reporter/src/`, so the
package named `vitest-agent-reporter` now actually contains a reporter.
The former internal `_defaultReporter` is promoted to a public,
documented export named `DefaultVitestAgentReporter`. `vitest-agent-ui`
becomes a pure rendering-primitives library and no longer exports
`_defaultReporter`, `_createLiveInk`, `buildDispatchInputs`,
`resolveCellOptions`, `renderAgentStringForReport`, or
`renderHumanStringForReport` — those now live in (and are re-exported
from) `vitest-agent-reporter`.

`vitest-agent-reporter` gains `react` and `ink` as full dependencies and
drops the redundant `vitest-agent-cli` and `vitest-agent-mcp` peer
dependencies. `vitest-agent-plugin` drops its direct dependency on
`vitest-agent-ui` and imports `DefaultVitestAgentReporter` from
`vitest-agent-reporter` as the single injected default factory.

### The reporter owns live rendering end to end

The plugin no longer orchestrates rendering. The Ink live-mount
lifecycle — mount, per-event rerender, unmount — moves out of the
plugin's `AgentReporter` and into `DefaultVitestAgentReporter`. The
plugin publishes one run event per Vitest streaming callback onto a
`PubSub` channel and injects exactly one reporter factory; the reporter
subscribes to the channel and owns every render mount itself.

### Reporter contract changes

`ReporterKit` gains an optional `runEvents` field carrying the live
run-event `PubSub` channel. `VitestAgentReporter.render` now takes a
second argument — a health-aware `ReporterKit` resolved at run end —
alongside the existing `ReporterRenderInput`. The factory is invoked at
run start so a live-painting reporter can subscribe before the first
event arrives. Custom reporters must update their `render` signature to
`render(input, kit)`.

### Lockstep versioning

`vitest-agent-ui` is added to the changeset `fixed` lockstep array so it
versions in step with the rest of the package family.
