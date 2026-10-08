---
"@vitest-agent/plugin": minor
---

## Breaking Changes

`AgentReporterConstructorOptions` no longer has the optional `format` field. It was never read.

## Features

The plugin now captures stray worker output (tests, or child processes they start with inherited stdio, writing directly to stdout or stderr). It wraps Vitest's logger output and error streams in owned console modes, routes whole lines to the reporter while a live view is up so they print above the frame, and puts the run's `strayOutput` on every report.

Known limits: the `threads` and `vmThreads` pools cannot see output from a child process a worker thread starts, and the passthrough console mode is not captured.
