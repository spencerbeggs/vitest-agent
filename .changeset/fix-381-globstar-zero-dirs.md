---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed `coverageTargets` glob matching to let a `**` segment match zero directories, agreeing with Vitest's own picomatch-based threshold matcher — `src/**/*.ts` now matches `src/index.ts` in addition to deeper paths, so a coverage target scoped to a glob no longer skips files at the top of the globbed directory
