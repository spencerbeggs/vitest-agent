---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now forwards `VITEST_AGENT_TDD_TASK_ID` (when set in the subagent's environment) to `agent record tdd-artifact` as `--tdd-task-id`, so a TDD subagent whose hooks attribute to a detached session no longer gets every phase transition denied for missing evidence (#144).
