---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now distinguishes a bats invocation from a vitest/jest one and passes `--suite bats` to `agent record tdd-artifact` on a bats match, so a bats-only behavior can now pass `red→green` and `green→refactor` through the phase-transition gate (#363).
