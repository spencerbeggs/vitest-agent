---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- `tdd_phase_transition_request`'s `missing_artifact_evidence` denial now diagnoses the detached-session case: when other sessions of the same conversation recorded artifacts recently, the hint names the count and the `VITEST_AGENT_TDD_TASK_ID` escape hatch instead of just reporting "no artifact found" (#144).
