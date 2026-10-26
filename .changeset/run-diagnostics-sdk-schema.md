---
"@vitest-agent/sdk": minor
---

## Features

### Run diagnostics in the agent report

Adds the `RunDiagnostics` schema family so performance hints, post-run timing, and persistence status travel with a run instead of being lost when the plugin owns stdout (#544).

* `RunDiagnostics` carries `performanceHints` (kinds `environment`, `import`, `transform`, `isolate`), optional `postRun` timing (`persistMs`, `coverageScanMs`, `totalMs`), and optional `persistence` status
* `RunReportFile` (`run.json`) gains an optional `runDiagnostics` field; `schemaVersion` stays `1`, and the published `schemas/5.0/run.json` is updated
* `ReporterRenderInput` gains an optional `runDiagnostics` so custom reporters can render the same data
* New `suggestedActionsFromRunDiagnostics()` maps diagnostics to suggested actions: a persistence failure ("Results were not saved"), slow post-run work, then one info action per hint
* New `isPostRunSlow()` and the `POST_RUN_SLOW_MS`, `POST_RUN_SLOW_SHARE`, and `POST_RUN_SLOW_MIN_MS` constants define "slow" (5s total, or at least 1s and 10% of Vitest's duration)
