---
"@vitest-agent/mcp": minor
---

## Features

- `test_errors` rows carry `traceSteps`: the Vitest 5.1 trace-timeline steps of the failed attempt (name, status, start, duration, depth, locator, location), oldest first and capped at ten. The list is empty when a test recorded no trace.
