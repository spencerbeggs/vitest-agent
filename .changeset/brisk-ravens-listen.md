---
"@vitest-agent/mcp": minor
---

## Features

`run_tests` results now include `report.strayOutput` next to `consoleLeaks`. It reports output that tests, or child processes they start, wrote straight to stdout or stderr during the run.
