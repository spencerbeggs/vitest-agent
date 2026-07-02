---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* `test_history`'s "Recovered" detection previously compared the last two entries in `runs` as if the array were oldest-first; `runs` is actually ordered most-recent-first, so the comparison had it backwards. Fixed the ordering so recovered tests (previously failing, now passing) are detected correctly.

## Features

* `test_history` tool output rows (`FlakyTestRow`, `PersistentFailureRow`, `RecoveredTestRow`) and the generated markdown now include `modulePath`, so same-named tests in different files are distinguishable in the results
