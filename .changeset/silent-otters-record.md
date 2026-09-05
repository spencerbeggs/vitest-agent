---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now recognizes `bats` invocations and records run-level `test_failed_run` / `test_passed_run` artifacts from the exit code, so a bats-driven test run is no longer invisible to TDD phase-transition evidence (#360).
