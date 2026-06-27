---
"@vitest-agent/mcp": minor
---

## Features

### Console Leak Signal in run_tests

The `run_tests` tool now collects stray console output during the test run and folds it into the `AgentReport` as an optional `consoleLeaks` field. The structured signal includes:

- Total write count across the run
- Per-file stdout/stderr split with up to 10 attributable test names per file
- A truncated first-line sample of the first write seen per file
- A `truncated` flag when more than 25 files produced stray output

The tool's markdown output includes a one-line warning when leaks are present:

```text
⚠ N stray console writes across M+ files (see consoleLeaks)
```

No configuration is required. The signal is omitted entirely on runs with no stray output.
