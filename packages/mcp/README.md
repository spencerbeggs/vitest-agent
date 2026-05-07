# vitest-agent-mcp

MCP server bin for
[vitest-agent-reporter](https://github.com/spencerbeggs/vitest-agent-reporter).
Exposes 53 tools over stdio (via tRPC) that give LLM agents structured
access to test data, coverage, history, trends, errors, per-file
coverage, individual test details, run-tests, cache health, settings,
a notes CRUD/search system, Claude Code session and turn logs, TDD
lifecycle state with a three-tier Objective→Goal→Behavior hierarchy,
hypotheses, failure signatures, and workspace commit history. The server
also surfaces four MCP resources (vendored Vitest docs and curated
testing patterns) and six framing-only prompts for common workflows.

This package is a required peer dependency of `vitest-agent-reporter`,
so you usually don't install it directly — modern pnpm and npm pull it
in automatically when you install the reporter. The Claude Code plugin
shipped with `vitest-agent-reporter` registers this server
automatically.

## Install

```bash
npm install --save-dev vitest-agent-reporter
# vitest-agent-mcp auto-installed via peerDependency
```

If your package manager skips peers, install it explicitly:

```bash
pnpm add -D vitest-agent-mcp
```

## Usage

The MCP server runs over stdio and is typically started by an MCP
client (e.g. Claude Code via the bundled plugin). To start it
manually:

```bash
npx vitest-agent-mcp
```

The server reads the SQLite database written by `AgentReporter` from
the same XDG-derived path the reporter uses, so a single test run
populates data for both the CLI and MCP tools.

## Tool overview

`help` returns the full tool catalog with parameter signatures. The
53 tools cover read-only queries (`test_status`, `test_overview`,
`test_coverage`, `test_history`, `test_trends`, `test_errors`,
`test_for_file`, `test_get`, `file_coverage`, `cache_health`,
`configure`), discovery (`project_list`, `test_list`, `module_list`,
`suite_list`, `settings_list`), execution (`run_tests`), notes
(`note_create`, `note_list`, `note_get`, `note_update`, `note_delete`,
`note_search`), session/turn reads (`session_list`, `session_get`,
`turn_search`, `failure_signature_get`, `acceptance_metrics`,
`get_current_session_id`, `set_current_session_id`),
triage/wrapup reads (`triage_brief`, `wrapup_prompt`), hypothesis
writes (`hypothesis_record`, `hypothesis_validate`, `hypothesis_list`),
TDD lifecycle (`tdd_session_start`, `tdd_session_end`,
`tdd_session_resume`, `tdd_session_get`, `tdd_phase_transition_request`),
TDD goal CRUD (`tdd_goal_create`, `tdd_goal_get`, `tdd_goal_update`,
`tdd_goal_delete`, `tdd_goal_list`), TDD behavior CRUD
(`tdd_behavior_create`, `tdd_behavior_get`, `tdd_behavior_update`,
`tdd_behavior_delete`, `tdd_behavior_list`), workspace history
(`commit_changes`), and utility (`ping`, `help`).

`tdd_session_start` accepts an optional `runId` string; when provided,
it is stored on the session and returned in `tdd_session_get` output as
`run_id`. The idempotency cache is keyed on `run_id` when present,
letting the same goal text be retried in the same session with a fresh
run ID rather than replaying the old result.

`tdd_session_get` returns a markdown digest of a TDD session that
includes the `run_id` field, a Goals and Behaviors section when goal
and behavior rows exist, listing each goal with its ordinal and status
alongside its nested behaviors. `tdd_phase_transition_request` requires
a `goalId` and auto-promotes a behavior from `pending` to `in_progress`
when accepted with a `behaviorId`. It rejects transitions to `green`
from any phase other than `red`, `red.triangulate`, or `green.fake-it`
with a `wrong_source_phase` denial — the `red` phase must be entered
explicitly first.

## Resources

The server exposes four resources under two URI schemes, all returning `text/markdown`:

| URI | Description |
| --- | --- |
| `vitest://docs/` | Index of the vendored Vitest documentation snapshot |
| `vitest://docs/{path}` | Any page from the snapshot (e.g., `vitest://docs/api/mock`) |
| `vitest-agent://patterns/` | Index of the curated testing-patterns library |
| `vitest-agent://patterns/{slug}` | A single pattern by slug |

`vitest://` content is a vendored MIT-licensed snapshot of `vitest-dev/vitest` at a pinned tag — see `vendor/vitest-docs/manifest.json` for the tag, commit SHA, capture timestamp and source URL, and `vendor/vitest-docs/ATTRIBUTION.md` for the license notice. `vitest-agent://` content is project-authored.

## Prompts

MCP clients can pick these from a prompt menu to orient the agent toward common workflows. Each prompt emits a small templated user message — no tool data is pre-fetched on the server.

| Name | Arguments | Orients toward |
| --- | --- | --- |
| `triage` | `project?` | `triage_brief`, `failure_signature_get`, `hypothesis_record` |
| `why-flaky` | `test`, `project?` | `test_history`, `failure_signature_get` |
| `regression-since-pass` | `test`, `project?` | `test_history`, `commit_changes`, `turn_search` |
| `explain-failure` | `signature` | failure signature recurrence history |
| `tdd-resume` | `cc_session_id?` | active TDD session and iron-law transitions |
| `wrapup` | `kind?`, `since?` | mirrors what the post-hooks emit automatically |

## Refreshing the docs snapshot

Contributors can update the vendored Vitest documentation to a new upstream release:

```bash
pnpm run update-vitest-snapshot --tag v4.3.0
# example output (varies by environment)
```

This rewrites `vendor/vitest-docs/` and updates `manifest.json`. The `update-vitest-snapshot` Claude Code skill wraps this command and walks through the steps interactively.

## Documentation

See the
[main README](https://github.com/spencerbeggs/vitest-agent-reporter#readme)
and the
[MCP reference](https://github.com/spencerbeggs/vitest-agent-reporter/blob/main/docs/mcp.md).

## License

[MIT](./LICENSE)
