---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- `tdd_phase_transition_request` threads `current_phase_id` through to the D2 evidence-binding check, so a test first authored in an earlier phase and re-run inside the current phase is no longer wrongly denied (#245).
- `run_tests` summary now warns only on the actionable console-leak total and prints a separate informational note for console output captured from failing tests, instead of flagging every red run as a leak (#263).
