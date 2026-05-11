# vitest-agent-mcp

MCP server bin for
[vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent).
Exposes 29 action-keyed tools over stdio (via tRPC) that give LLM agents
structured access to test data, coverage, history, trends, errors,
per-file coverage, individual test details, run-tests, cache health,
settings, a notes CRUD/search system, Claude Code turn logs, TDD
lifecycle state with a three-tier Objective→Goal→Behavior hierarchy,
hypotheses, failure signatures, and workspace commit history. Tools
emit both markdown `content[]` and a typed `structuredContent` payload
per MCP 2025-06-18. The server also surfaces four MCP resources
(vendored Vitest docs and curated testing patterns) and six
framing-only prompts for common workflows.

This package is a required peer dependency of `vitest-agent-plugin`,
so you usually don't install it directly — modern pnpm and npm pull it
in automatically when you install the plugin. The Claude Code plugin
shipped with `vitest-agent-plugin` registers this server
automatically.

## Install

```bash
npm install --save-dev vitest-agent-plugin
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

`help` returns the full tool catalog with parameter signatures. The 29
tools cover read-only queries (`test_status`, `test_overview`,
`test_coverage`, `test_history`, `test_trends`, `test_errors`,
`file_coverage`, `cache_health`, `configure`), unified discovery
(`inventory` with `kind: project | module | suite | session`, plus
`test` with `action: list | get | for_file` and `settings_list`),
execution (`run_tests`), agent registration (`register_agent`), notes
(`note` with `action: create | list | get | update | delete | search`),
turn reads (`turn_search`, `failure_signature_get`,
`acceptance_metrics`), triage/wrap-up reads (`triage_brief`,
`wrapup_prompt`), hypothesis writes (`hypothesis` with `action: record
| validate | list`), TDD lifecycle (`tdd_task` with `action: start | end
| get | resume`, plus `tdd_phase_transition_request`), goal and
behavior CRUD (`tdd_goal` and `tdd_behavior` action-keyed), artifact
reads (`tdd_artifact_list`), workspace history (`commit_changes`), and
utility (`ping`, `help`).

`tdd_task` consolidates the 1.x `tdd_session_*` family. Action `start`
accepts an optional `runId`; when provided, it is stored on the session
and returned in `tdd_task` action `get` output as `run_id`. When `runId`
is present the idempotency key includes both the session identifier and
`runId` (e.g. `cc:<chatId>:run:<runId>`), letting the same goal text
be retried with a fresh `runId` to create a new session rather than
replaying the old result. Callers that omit `runId` fall back to
goal-text-based keying.

`tdd_task` action `get` returns a markdown digest of a TDD session that
includes the `run_id` field, plus a Goals and Behaviors section when
goal and behavior rows exist listing each goal with its ordinal and
status alongside its nested behaviors. `tdd_phase_transition_request`
requires a `goalId` and auto-promotes a behavior from `pending` to
`in_progress` when accepted with a `behaviorId`. It rejects transitions
to `green` from any phase other than `red`, `red.triangulate`, or
`green.fake-it` with a `wrong_source_phase` denial — the `red` phase
must be entered explicitly first.

All tools emit both markdown `content[]` for human-readable display and
a typed `structuredContent` payload per MCP 2025-06-18 — clients can
parse either channel.

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
| `triage` | `project?` | `triage_brief`, `failure_signature_get`, `hypothesis` (action `record`) |
| `why-flaky` | `test`, `project?` | `test_history`, `failure_signature_get` |
| `regression-since-pass` | `test`, `project?` | `test_history`, `commit_changes`, `turn_search` |
| `explain-failure` | `signature` | failure signature recurrence history |
| `tdd-resume` | `chat_id?` | active TDD session and iron-law transitions |
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
[main README](https://github.com/spencerbeggs/vitest-agent#readme)
and the
[MCP reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/mcp.md).

## License

[MIT](./LICENSE)
