---
"@vitest-agent/cli": patch
---

## Bug Fixes

Failure rendering now uses `@effected/cli` 0.14's `isCancelled` and `isNotInteractive`, so a cancelled prompt never prints the "Please report" issue link, even when the cancellation arrives as a defect.
