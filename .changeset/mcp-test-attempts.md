---
"@vitest-agent/mcp": minor
---

## Features

- `test_errors` rows carry an `attempt` (`retryIndex` and `repeatIndex`, or `null`) naming the retry or repeat that raised the error.
- `test_history` returns `retried[]`: the latest run's tests that ran more than one attempt, with every attempt's state, duration, start time and error ids. It honors `testName` and `modulePath`.
- The `why-flaky` prompt tells the agent to read the per-attempt results to see which attempt failed and how.
