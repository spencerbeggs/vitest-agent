---
"@vitest-agent/ui": patch
---

## Bug Fixes

- A run with unhandled errors is now classified as `some-fail` instead of being reported as passing.
- `renderAgent` and the Ink `StreamApp` now render an "Unhandled errors" section in every run shape, so a process-level unhandled error is no longer invisible in the default reporter output (#240).
