---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- Watch-mode reruns now render, persist and emit `RunFinished` again: the `onTestRunEnd` once-per-run guard is re-armed at every `onTestRunStart` instead of latching for the life of the reporter instance, while a repeated `onTestRunEnd` within one run still no-ops
- The previous run's coverage stash is dropped at `onTestRunStart`, so a rerun never reports stale coverage
