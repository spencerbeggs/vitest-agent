---
"@vitest-agent/reporter": major
---

## Breaking Changes

`_createLiveInk` and its `CreateLiveInkOptions` and `LiveInkRenderer` types are removed. The live view is now internal to `DefaultVitestAgentReporter`. A custom reporter that mounted it should subscribe to `kit.runEvents` and mount `StreamApp` with `reduceRenderState` from `@vitest-agent/ui` through `CliUi.live` from `@effected/cli/ui`, closing the view from the reporter's optional `close()`.

`@effected/cli`, `@effected/env`, `@effected/glob`, and `@effected/walker` are now peer dependencies.

## Features

- The stream live view runs on the `@effected/cli` live renderer. With `TERM=dumb` it falls back to ASCII and non-interactive output, and when piped the final frame is printed once.
- The step summary and `summary.md` are rendered through the kit document model. Trend lines now end in GFM hard breaks.

## Bug Fixes

- The `::group::` log block neutralizes workflow commands in project names and paths.
