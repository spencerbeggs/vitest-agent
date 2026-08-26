# Hook fixtures

Synthetic payloads for manual hook invocation and debugging.

## Usage

These fixtures are **templates**: the repository root is stored as the
literal token `__REPO_ROOT__` rather than a machine-specific absolute path,
so the bats suite is not pinned to one developer's checkout. Render a fixture
through `render-fixture.sh` — which substitutes the real root — instead of
`cat`-ing it:

```bash
# From the repo root:
bash plugin/hooks/__test__/render-fixture.sh \
  plugin/hooks/fixtures/post-tool-use-write-test.json \
  | bash plugin/hooks/post-tool-use/tdd-artifact.sh

bash plugin/hooks/__test__/render-fixture.sh \
  plugin/hooks/fixtures/post-tool-use-record-write.json \
  | bash plugin/hooks/post-tool-use/record.sh

bash plugin/hooks/__test__/render-fixture.sh \
  plugin/hooks/fixtures/user-prompt-submit.json \
  | bash plugin/hooks/user-prompt-submit/record.sh
```

Hook scripts `cd "$cwd"` before shelling out to the CLI, so a `cat` of the raw
template leaves `__REPO_ROOT__` in place, the `cd` fails, and the hook silently
no-ops.

To see errors and CLI output:

```bash
VITEST_AGENT_HOOK_DEBUG=1 \
  bash plugin/hooks/__test__/render-fixture.sh \
    plugin/hooks/fixtures/post-tool-use-write-test.json \
  | bash plugin/hooks/post-tool-use/tdd-artifact.sh

# Then inspect:
cat /tmp/vitest-agent-hook-debug.log
cat /tmp/vitest-agent-hook-errors.log
```

## Substitutions required

The fixtures use `__REPO_ROOT__` for the repository root (resolved by
`render-fixture.sh`) and a placeholder `SESSION_ID` for `session_id`. Before running,
substitute a real open CC session ID from the database:

```bash
SESSION_ID=$(sqlite3 ~/.local/share/vitest-agent/vitest-agent/data.db \
  "SELECT chat_id FROM sessions ORDER BY id DESC LIMIT 1;")

sed "s/SESSION_ID/$SESSION_ID/g" plugin/hooks/fixtures/post-tool-use-write-test.json \
  | bash plugin/hooks/post-tool-use/tdd-artifact.sh
```

Or set it inline:

```bash
cat plugin/hooks/fixtures/post-tool-use-write-test.json \
  | jq --arg sid "YOUR_CC_SESSION_ID" '.session_id = $sid' \
  | bash plugin/hooks/post-tool-use/tdd-artifact.sh
```

## Debug lifecycle capture

To capture real payloads during a lifecycle run, set `VITEST_AGENT_HOOK_DEBUG=1`
before reloading plugins. The log files are:

- `/tmp/vitest-agent-hook-errors.log` — CLI failures (always written)
- `/tmp/vitest-agent-hook-debug.log` — full input payloads + all CLI calls (debug mode)

The error log persists across sessions; truncate before a fresh capture:

```bash
> /tmp/vitest-agent-hook-errors.log
> /tmp/vitest-agent-hook-debug.log
```

## Files

| File | Hook | Scenario |
| --- | --- | --- |
| `post-tool-use-write-test.json` | `post-tool-use/tdd-artifact.sh` | Write tool on a test file |
| `post-tool-use-run-tests-pass.json` | `post-tool-use/tdd-artifact.sh` | `run_tests` MCP — passing run |
| `post-tool-use-run-tests-fail.json` | `post-tool-use/tdd-artifact.sh` | `run_tests` MCP — failing run |
| `post-tool-use-edit-prod.json` | `post-tool-use/tdd-artifact.sh` | Edit tool on a production file |
| `post-tool-use-record-write.json` | `post-tool-use/record.sh` | Write tool turn recording |
| `user-prompt-submit.json` | `user-prompt-submit/record.sh` | User prompt recording |
