---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed `coverageTargets` glob matching to agree with Vitest's own picomatch-based threshold matcher — a `**` segment now matches zero directories (`src/**/*.ts` matches `src/index.ts`), and brace groups, character classes, and extglobs are honoured, so a glob-scoped coverage target no longer silently skips top-level files or, for a pattern like `src/**/*.{ts,tsx}`, every file under it
