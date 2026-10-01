---
"@vitest-agent/sdk": minor
---

## Features

- `VitestAgentReporter` gains an optional `close?: () => Promise<void>` hook. The plugin calls it once when Vitest closes (not per run, so watch mode keeps one reporter across reruns) and before the run-event channel shuts down, so a custom reporter can drain what it was published and release anything it acquired, such as a live view waiting to commit its last frame. A rejection is logged as a warning rather than failing the run.
