---
"vitest-agent-reporter": major
---

## Features

### `stream` mode live renderer with an animation clock

`DefaultVitestAgentReporter` now subscribes its live Ink mount when `consoleMode` resolves to `stream` (formerly `ink`). The live mount renders the new agent-shaped `StreamApp` component instead of the deleted `App`.

`createLiveInk` gains an animation clock: a `setInterval` that rerenders on a fixed cadence so the spinner glyph and the ticking elapsed column advance between discrete `RunEvent` arrivals. The clock starts in the `RunStarted` branch — not on mount — so watch-mode reruns each animate; it is cleared on the terminal event (`RunFinished` or `RunTimedOut`) and again defensively in teardown, so it never outlives the instance. The spinner frame index is derived from wall-clock time, so it stays correct across watch-mode remounts with no counter to reset.
