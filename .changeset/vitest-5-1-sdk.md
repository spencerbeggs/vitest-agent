---
"@vitest-agent/sdk": minor
---

## Features

- New export `finalAttemptErrors(testCase)` returns the errors of the attempt that decided a test's outcome: none for a test that passed or was skipped, and the last failing attempt's errors for a failed test, read from Vitest 5.1's `TestCase.attempts()`.
- `VitestTestCase` gains an optional `attempts()`, and `VitestTestDiagnostic` gains optional `retryCount` and `repeatCount`.

## Bug Fixes

- `buildAgentReport` reports a failed retried or repeated test with the deciding attempt's errors instead of every error accumulated across attempts.
- `isTimeoutError` detects around-hook timeouts ("hook timed out after N ms") and matches only Vitest's `TestTimeoutError` and `HookTimeoutError` by name, so user errors such as "Request timed out after 500ms" or an `AbortSignal.timeout` `TimeoutError` are no longer counted as test timeouts.
