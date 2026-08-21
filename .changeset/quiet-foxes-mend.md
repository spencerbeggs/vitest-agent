---
"@vitest-agent/plugin": patch
---

## Bug Fixes

Discovery's helper-directory exclusion (`__test__/utils/`, etc.) no longer matches at any depth under `__test__/`. It now anchors directly beneath the test root, matching how the include glob is anchored, so a nested suite such as `__test__/unit/utils/parse.test.ts` is no longer silently dropped from discovery — only a helper directory named directly under `__test__/` (e.g. `__test__/utils/`) is excluded.
