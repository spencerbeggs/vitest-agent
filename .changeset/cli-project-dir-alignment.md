---
"@vitest-agent/cli": patch
---

## Bug Fixes

- `agent check-test-path` classifies paths against the same project directory as every other command. It now follows the full `VITEST_AGENT_PROJECT_DIR` → `VITEST_AGENT_REPORTER_PROJECT_DIR` → `CLAUDE_PROJECT_DIR` → working-directory order, and a blank or unsubstituted `${...}` value counts as unset instead of anchoring the check on an empty path.
- `agent record run-workspace-changes` validates its files-json argument before recording anything. An array entry with an unknown `changeKind`, or text that is not JSON, is now a usage error (exit 64) naming the problem, where it used to reach the database unchecked or exit 1. The post-commit hook ignores the exit code, so hook behaviour is unchanged.

## Refactoring

- Every command writes its output through Effect's `Console` and the kit's `CliFormat.printJson` instead of writing to the process streams directly. The bytes on stdout and stderr are unchanged; JSON output additionally escapes `##[` under GitHub Actions so the runner cannot read it as a workflow command.
