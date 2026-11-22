---
"@vitest-agent/engine": minor
---

## Features

- Add migration `0006_test_attempts`: a `test_attempts` child table of `test_cases` holding one row per retry and repeat attempt (retry index, repeat index, state, duration, start time), plus a nullable `test_errors.attempt_id` linking an error to the attempt that raised it. Existing rows are untouched.
- `DataStore.writeTestAttempts` persists attempts and `TestErrorInput` accepts an `attemptId`. `DataReader.getErrors` returns each error's `attempt`, and the new `DataReader.getRetriedTests` lists the latest run's tests that ran more than one attempt.
