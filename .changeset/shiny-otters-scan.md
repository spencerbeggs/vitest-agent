---
"@vitest-agent/mcp": minor
---

## Features

Added `discoveryLastScannedAt` to the `run_tests` tool result (`RunTestsOk`) — an ISO timestamp of the most recent real disk scan performed by discovery, or `null` if discovery hasn't scanned disk yet in this process. Lets an agent confirm whether a suspicious test count reflects a fresh scan rather than a stale cache. Additive and backward-compatible.
