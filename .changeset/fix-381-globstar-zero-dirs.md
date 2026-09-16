---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed `coverageTargets` glob matching to agree with Vitest's own picomatch-based threshold matcher — a `**` segment now matches zero directories (`src/**/*.ts` matches `src/index.ts`), and brace groups, character classes, and extglobs are honoured, so a glob-scoped coverage target no longer silently skips top-level files or, for a pattern like `src/**/*.{ts,tsx}`, every file under it
* Fixed the coverage analyzer to match glob patterns against paths relative to the Vitest config root, and a partial run's scoped file set to be built from each test module's absolute path — coverage providers key files by absolute path, so a relative glob key never matched in a real run and the scoped threshold check (issue #160) never flagged anything
