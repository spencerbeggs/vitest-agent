---
"vitest-agent-ui": major
---

## Features

### `StreamApp` — an agent-shaped, lifecycle-aware live renderer

New `StreamApp` Ink component for the `stream` console mode. Unlike the deleted `App` — a Vitest-shaped flat per-file list — `StreamApp` lays the run out in the dispatcher's run-shape framing: one row per project for `workspace`, one row per module for `single-project`, one row per test for `single-file` and `single-test`. A running unit shows an animated Braille spinner that resolves to `✓` / `⚠` / `✗` on finish, and an elapsed column ticks while the unit runs. A new `ProjectRow` leaf renders the per-project rollup; a `spinner` module supplies the hand-rolled frame array.

### Shared `formatDisplayDuration`

A single display formatter rounds sub-second millisecond durations to one decimal place and keeps the seconds form at or above one second. `render-agent.ts`, the `render-ink` components, the dispatcher helpers, and `StreamApp` all call it, so a duration looks the same wherever it appears. Display only — full-precision durations still persist to the database unchanged.

## Breaking Changes

### Remove `App` and `ModuleRow`

The `App` root component and its `ModuleRow` child have no callers once `StreamApp` lands and are deleted. The reducer now folds the eleven new `RunEvent` variants — `RunTimedOut` advances to the terminal `timed-out` phase; the other ten pass through as no-ops, still delivered to every PubSub subscriber and the `onRunEvent` tap.
