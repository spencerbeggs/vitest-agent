---
"@vitest-agent/sdk": minor
---

## Features

- Add `TraceStep` and an optional `traceSteps` list on `ReportError`, plus `normalizeTraceSteps`, which turns a test's `internal:browserTrace` artifacts into the failed attempt's last ten steps (merged ranges, `vitest:` prefix removed, `onAfterRetryTask` dropped). The published run report schema gains the optional field. `buildAgentReport` attaches the steps to a failed test's first error and accepts a `root` option.
