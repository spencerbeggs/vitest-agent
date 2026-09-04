---
"@vitest-agent/sdk": patch
---

## Bug Fixes

- `validatePhaseTransition`'s D2 evidence-binding check now keys the phase window off the cited artifact's own `phase_id` instead of the test case's first creation turn. A test first authored during `spike` and re-run inside `red` is no longer denied with `evidence_not_in_phase_window` on `red`→`green` (#245).
- `buildConsoleLeaks` now counts only console output from non-failing tests toward `total`/`byFile`. Output logged inside a failing test is excluded from the leak signal and summarized separately in the new optional `fromFailingTests` field on `ConsoleLeaks`, so a red run no longer looks like a leaking green run (#263).
