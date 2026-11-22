---
"@vitest-agent/engine": minor
---

## Features

- Add migration `0007_trace_steps`: a `test_trace_steps` child table of `test_cases` (and of the `test_attempts` row when known) holding the Vitest 5.1 trace-timeline steps of a failed attempt, with cascade on delete so run retention reaps them with their cases.
- `DataStore.writeTraceSteps` persists the steps and `DataReader.getErrors` returns them as `traceSteps` on each error of the test; the list is empty when none was recorded.
