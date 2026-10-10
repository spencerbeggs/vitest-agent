# Hook fixtures

Synthetic hook payloads, in Claude Code's shape, for the bats suites. Copilot runs hooks declared under Claude Code event names with a Claude-shaped payload, so the same fixtures drive both targets.

Every fixture sets `hook_event_name`, which `run_hook` uses to pick the built entry, and the session id `test-session-id-bats-001`. The project directory is the literal token `__PROJECT__`: the suites render a fixture with `va_fx <fixture> [overrides-json]` (`__test__/common.bash`), which substitutes the test's own project directory and merges any overrides, so nothing is pinned to one checkout.

```bash
# Inside a .bats file that ran `load common`
va_stub_cli
va_hook claude hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-write-test.json)"
va_hook copilot hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-write-test.json)"
```

`va_stub_cli` writes a fake `vitest-agent` that records its argv, and `va_hook` routes the hook at it through `VITEST_AGENT_CLI_CMD`. For a one-off payload, `hook_fixture <Event> '<overrides>'` from pluginfinity's helper builds one with the test project as `cwd`.

## Running a hook by hand

Hooks run from `builds/`, never from the source, and need the environment the host gives them. The bats helper sets it up; to see what a real session sends and answers, run a host with `PLUGINFINITY_DEBUG=1` and read `pnpm exec pluginfinity logs --debug`, which records each hook's raw input and outcome.

| Fixture | Event | Scenario |
| --- | --- | --- |
| `session-start.json` | SessionStart | Fresh session with a transcript path |
| `session-end.json` | SessionEnd | Session end (`reason` overridden per test) |
| `user-prompt-submit.json` | UserPromptSubmit | Failure-related prompt |
| `pre-tool-use-bash.json` | PreToolUse | Bash `pnpm exec vitest run` |
| `pre-tool-use-record.json` | PreToolUse | Read of `package.json` |
| `post-tool-use-*.json` | PostToolUse | Bash test/build/commit runs, `run_tests` pass/fail, test and production edits |
| `pre-compact.json`, `stop.json` | PreCompact, Stop | Lifecycle firings |
| `subagent-start-tdd.json`, `subagent-stop-tdd.json` | SubagentStart, SubagentStop | tdd-task dispatch and completion |
