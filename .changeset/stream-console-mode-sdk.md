---
"vitest-agent-sdk": major
---

## Breaking Changes

### Rename the `ink` console mode to `stream`

`HumanConsoleMode` is now `passthrough | silent | stream | agent`. The `ink` value — named after the rendering library, an implementation detail — is replaced by `stream`, which names the user-visible behavior: a progressively-drawn, colored, animated rendering of the agent's run-shape view. Pre-2.0 this is a clean break with no deprecation alias; the value `ink` ceases to exist.

## Features

### Complete the internal `RunEvent` surface

`RunEvent` gains eleven variants so every Vitest 4.x reporter hook maps to an emitted event: `ModuleCollected`, `SuiteStarted`, `SuiteFinished`, `HookStarted`, `HookFinished`, `ConsoleLog`, `RunTimedOut`, `TestAnnotated`, `TestArtifactRecorded`, `WatcherReady`, and `WatcherRerun`. The internal event system is now whole — future consumers such as analytics taps or an MCP dashboard never need to touch the plugin's Vitest-API layer to widen it.

The three module variants — `ModuleQueued`, `ModuleStarted`, `ModuleFinished` — gain an optional `projectName`. `ModuleRecord` gains optional `projectName` and `startedAt`; `RenderState` gains a terminal `timed-out` phase. These are in-memory `RunEvent` / `RenderState` schema additions only — nothing in this change touches a SQLite table.
