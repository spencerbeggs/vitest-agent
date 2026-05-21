---
"vitest-agent-plugin": major
---

## Features

### Wire every Vitest reporter hook to a `RunEvent`

`AgentReporter` now implements every Vitest 4.x streaming hook and emits the matching `RunEvent`: `onTestModuleCollected`, `onTestSuiteReady`, `onTestSuiteResult`, `onHookStart`, `onHookEnd`, `onUserConsoleLog`, `onProcessTimeout`, `onTestCaseAnnotate`, `onTestCaseArtifactRecord`, `onWatcherStart`, and `onWatcherRerun`. The module hooks now populate `projectName` from `TestModule.project.name`.

## Bug Fixes

### Emit `TestStarted` from `onTestCaseReady`

`TestStarted` was synthesized back-to-back with `TestFinished` inside `onTestCaseResult`, so the transient running state never got a render frame. `onTestCaseReady` is now wired and emits a standalone `TestStarted`; `onTestCaseResult` emits only `TestFinished`. The running state now has a real lifetime in the event stream.

### Emit the coverage events from `onTestRunEnd`

`CoverageReady` and `ThresholdViolation` were fully defined and reduced but never published — a live subscriber got no coverage frame. The raw `onCoverage` istanbul map cannot populate the typed payloads; the analyzed result can, and is ready by `onTestRunEnd`. Both events are now emitted there, one `ThresholdViolation` per violated metric.
