---
"@vitest-agent/mcp": minor
---

## Features

- `run_tests` accepts a `lastFailed` boolean that reruns only the tests that failed in their last run, using Vitest 5.1's last-failed results cache. It counts as a filter, so the scoped-coverage note applies, and it is echoed as `lastFailed` on the `ok` result's `scope` and the `no-match` result's `filter`. When nothing is selected, including with `cache: false`, Vitest's "no test files found" error is returned as the `no-match` result instead of an error.
