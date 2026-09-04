---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The live `RunFinished` event now populates `unhandledErrors`, so a process-level unhandled error captured during a run is no longer dropped before it reaches the reporter (#240).
