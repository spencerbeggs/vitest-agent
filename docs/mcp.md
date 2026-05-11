# MCP Server

The `vitest-agent-mcp` binary provides an
[MCP](https://modelcontextprotocol.io/) server over stdio transport,
exposing 29 action-keyed tools for querying test data, managing notes,
running tests, discovering project structure, and managing TDD goals
and behaviors. CRUD-style families are consolidated into a single tool
that dispatches on an `action` (or `kind`) discriminator. Every tool
emits both markdown `content[]` for human-readable display and a typed
`structuredContent` payload per MCP 2025-06-18 — clients can parse
either channel. The server also exposes four resources (vendored
Vitest docs and curated testing patterns) and six framing-only prompts
for common workflows. LLM agent hosts like Claude Code can call these
tools directly during a session.

## How It Works

After each test run, `AgentReporter` writes structured data to a SQLite
database. The MCP server reads this database on demand -- no background
process, no polling. Each tool call opens the database, executes a query,
and returns the result.

The server uses the `@modelcontextprotocol/sdk` package and communicates
over stdio (stdin/stdout JSON-RPC).

## Starting the Server

### Automatic (via Claude Code plugin)

The Claude Code plugin registers the MCP server automatically. No manual
configuration needed:

```bash
/plugin marketplace add spencerbeggs/bot
/plugin install vitest-agent@spencerbeggs-bot --scope project
```

The plugin declares the MCP server inline in
`.claude-plugin/plugin.json` and ships a small loader at
`bin/mcp-server.mjs` that resolves and launches the server from
`vitest-agent-plugin` installed in your project's `node_modules`.
This means the package **must be installed as a project dependency**
for the plugin's MCP server to start; the loader fails fast with
explicit install instructions if it's missing.

### Manual

The MCP server lives in its own package (`vitest-agent-mcp`),
which auto-installs as a peer dependency of `vitest-agent-plugin` on
modern pnpm and npm. Start the server directly:

```bash
npx vitest-agent-mcp
```

Or add it to your `.mcp.json` manually:

```json
{
  "mcpServers": {
    "vitest-reporter": {
      "command": "npx",
      "args": ["vitest-agent-mcp"]
    }
  }
}
```

The server reads the SQLite database from the same XDG-derived path the
reporter writes to (default
`$XDG_DATA_HOME/vitest-agent/<workspaceName>/data.db`,
fallback `~/.local/share/vitest-agent/<workspaceName>/data.db`),
so a single test run populates data for the MCP tools, the CLI, and the
reporter's own console output.

## Tool reference

Several CRUD-style families consolidate into a single action-keyed tool. For example, the 1.x `tdd_session_start`, `tdd_session_end`, `tdd_session_get`, and `tdd_session_resume` tools are now `tdd_task` with `action: start | end | get | resume`. Pass the action discriminator alongside the rest of the input shape.

### Meta

#### `help`

List all available MCP tools with their parameters and descriptions.

No parameters. Returns a complete tool catalog organized by category.

#### `ping`

Health check. Returns `{ pong: true }`.

### Read-only test queries

These tools query the SQLite database and return markdown for human consumption plus a typed `structuredContent` payload.

#### `test_status`

Per-project test pass/fail state from the most recent run.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Filter to a specific project |

#### `test_overview`

Test landscape summary with per-project run metrics.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Filter to a specific project |

#### `test_coverage`

Coverage gap analysis with per-metric thresholds and targets.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Project name |

#### `test_history`

Flaky tests, persistent failures, and recovered tests with run visualization.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | Yes | Project name |

#### `test_trends`

Per-project coverage trend with direction, metrics, and sparkline trajectory.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | Yes | Project name |
| `limit` | `number` | No | Max number of trend entries to return |

#### `test_errors`

Detailed test errors with diffs and stack traces for a project.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | Yes | Project name |
| `errorName` | `string` | No | Filter to a specific error name |

#### `file_coverage`

Per-file coverage with uncovered line ranges and the test modules that cover the file.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | `string` | Yes | Source file path to look up |

#### `configure`

View captured Vitest settings for a test run.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `settingsHash` | `string` | No | Settings hash from a manifest entry or test run |

#### `cache_health`

Database health diagnostic: manifest presence, project states, staleness. No parameters.

#### `settings_list`

List all captured Vitest config snapshots with their hashes. No parameters.

#### `acceptance_metrics`

Compute the four acceptance-quality ratios: phase-evidence integrity, compliance-hook responsiveness, orientation usefulness, and anti-pattern detection rate. No parameters.

### Discovery

#### `inventory`

Unified discovery across projects, test modules, suites, and Claude Code sessions. Dispatches on the `kind` discriminator and optionally returns a single row by `id`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `string` | Yes | One of: `project`, `module`, `suite`, `session` |
| `id` | `string \| number` | No | Single-row lookup |
| `project` | `string` | No | Filter modules / suites / sessions to a project (when `id` is absent) |
| `module` | `string` | No | Filter suites to a module file path |
| `agentKind` | `string` | No | Sessions only: `"main"` or `"subagent"` |
| `limit` | `number` | No | Sessions only: max results (default 50) |

#### `test`

Read individual test cases or find tests that cover a source file.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `list`, `get`, `for_file` |
| `project` | `string` | No | `list` / `get`: filter by project |
| `state` | `string` | No | `list`: filter by state (`passed`, `failed`, `skipped`, `pending`) |
| `module` | `string` | No | `list`: filter by module file path |
| `limit` | `number` | No | `list`: max results |
| `fullName` | `string` | `get` only | Full test name (`Suite > nested > test`) |
| `filePath` | `string` | `for_file` only | Source file path to find tests for |

#### `turn_search`

Search the turn log for a session.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | No | Filter by session ID |
| `type` | `string` | No | Filter by turn type (`user_prompt`, `tool_call`, `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`) |
| `since` | `string` | No | ISO 8601 lower-bound timestamp |
| `limit` | `number` | No | Max results (default: 50) |

#### `failure_signature_get`

Read a failure signature by its hash, including up to 10 recent matching test errors.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `hash` | `string` | Yes | 16-char hex signature hash |

### Execution

#### `run_tests`

Execute vitest for specific files or patterns. Returns a `RunTestsResult` discriminated union: `{ kind: "ok", report, classifications }`, `{ kind: "timeout", timeoutSeconds }`, or `{ kind: "error", message }`. The `report` field is the full `AgentReport` (pass/fail counts plus per-module errors); `classifications` is a map from test full-name to one of `stable`, `new-failure`, `persistent`, `flaky`, `recovered`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | `string[]` | No | Test file paths to run |
| `project` | `string` | No | Project name to filter |
| `timeout` | `number` | No | Timeout in seconds (default: 120) |

### Agent registration

#### `register_agent`

Wrap `DataStore.registerAgent` to record the active agent in the `agents` table. Idempotent on `(agentType, parentAgentId, clientNonce)`. Validates that `agentType` begins with `${hostKind}-`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `agentType` | `string` | Yes | Agent type identifier; must begin with the host kind prefix |
| `parentAgentId` | `string` | No | UUID of the parent agent (subagent registration) |
| `clientNonce` | `string` | No | Caller-supplied nonce for explicit idempotency |
| `hostSessionId` | `string` | No | Host session id (writes to `session_map`) |

Returns `{ ok: true, agentId, conversationId, idempotencyKey }` on insert or replay, or `{ ok: false, error: { code, ... } }` for `AGENT_ALREADY_REGISTERED`, `PARENT_AGENT_NOT_FOUND`, `SESSION_NOT_FOUND`, or `INVALID_AGENT_TYPE_PREFIX`.

### Notes

The notes system provides CRUD operations and full-text search for persisting debugging notes across sessions. Notes can be scoped to a project, module, suite, test, or left as free-form.

#### `note`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `create`, `list`, `get`, `update`, `delete`, `search` |
| `title` | `string` | `create` | Note title |
| `content` | `string` | `create` | Note content (markdown supported) |
| `scope` | `string` | `create` | One of: `global`, `project`, `module`, `suite`, `test`, `note` |
| `project` | `string` | No | Project name (create scope filter, list filter) |
| `testFullName` | `string` | No | Full test name (test scope, list filter) |
| `modulePath` | `string` | No | Module file path (module scope) |
| `parentNoteId` | `number` | No | Parent note ID for threading (`note` scope) |
| `createdBy` | `string` | No | Creator identifier |
| `expiresAt` | `string` | No | ISO 8601 expiration timestamp |
| `pinned` | `boolean` | No | Pin the note |
| `id` | `number` | `get`, `update`, `delete` | Note ID |
| `query` | `string` | `search` | Search query |

`list` and `search` actions return markdown; `create`, `get`, `update`, and `delete` return JSON.

### Triage and wrap-up

#### `triage_brief`

Orientation summary for a new session: recent run status, open failures, and triage context.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Filter to a specific project |
| `maxLines` | `number` | No | Max lines in the output |

#### `wrapup_prompt`

Interpretive wrap-up nudge injected by Stop, SessionEnd, PreCompact, and UserPromptSubmit hooks.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `chatId` | `string` | No | Claude Code session ID |
| `kind` | `string` | No | One of: `stop`, `session_end`, `pre_compact`, `tdd_handoff`, `user_prompt_nudge` |
| `userPromptHint` | `string` | No | Prompt text for `user_prompt_nudge` variant |

### Hypotheses

Hypothesis writes go through the tRPC idempotency middleware so duplicate calls from a retrying agent replay the cached response instead of double-writing.

#### `hypothesis`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `record`, `validate`, `list` |
| `sessionId` | `number` | `record` | Database session ID |
| `content` | `string` | `record` | Hypothesis text |
| `citedTestErrorId` | `number` | No | `test_errors.id` FK |
| `citedStackFrameId` | `number` | No | `stack_frames.id` FK |
| `createdTurnId` | `number` | No | `turns.id` FK |
| `id` | `number` | `validate` | Hypothesis ID |
| `outcome` | `string` | `validate` (input) / `list` (filter) | One of: `confirmed`, `refuted`, `abandoned`, `open` |
| `validatedAt` | `string` | `validate` | ISO 8601 timestamp |
| `validatedTurnId` | `number` | No | `turns.id` FK |
| `limit` | `number` | No | `list`: max results (default 50) |

### TDD lifecycle

These tools drive the TDD orchestrator subagent's state machine. Action-keyed writes (`tdd_task.start`, `tdd_task.end`, `tdd_goal.create`, `tdd_behavior.create`) go through the idempotency middleware.

#### `tdd_task`

Consolidates the 1.x `tdd_session_*` family. The underlying SQLite columns retain the `tdd_tasks` naming.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `start`, `end`, `get`, `resume` |
| `goal` | `string` | `start` | TDD session goal |
| `sessionId` | `number` | No | Database session ID (use when `chatId` is unavailable) |
| `chatId` | `string` | No | Claude Code session ID |
| `parentTddTaskId` | `number` | No | Parent TDD session for delegation |
| `runId` | `string` | No | `start`: optional retry key; stored on the session and surfaced as `run_id` from `get` |
| `startedAt` | `string` | No | `start`: ISO 8601 timestamp (defaults to now) |
| `tddTaskId` | `number` | `end` | TDD session ID |
| `outcome` | `string` | `end` | One of: `succeeded`, `blocked`, `abandoned` |
| `summaryNoteId` | `number` | No | `end`: optional note FK |
| `id` | `number` | `get`, `resume` | TDD session ID |

`start` is idempotent on `(sessionId, goal)`. When `runId` is present the idempotency key includes both the session identifier and `runId` (e.g. `cc:<chatId>:run:<runId>`), letting the same goal text be retried with a fresh `runId` to create a new session rather than replaying the old result. `end` is idempotent on `(tddTaskId, outcome)`. `get` returns a Goals and Behaviors section when goal and behavior rows exist, listing each goal with its ordinal and status alongside its nested behaviors.

#### `tdd_phase_transition_request`

Request a TDD phase transition. Pre-checks goal status and behavior membership, then validates the cited evidence artifact against the three D2 binding rules before writing the new phase row. When accepted with a `behaviorId`, auto-promotes that behavior from `pending` to `in_progress`. Transitions to `green` from any phase other than `red`, `red.triangulate`, or `green.fake-it` are rejected with `wrong_source_phase` — the `red` phase must be entered explicitly first. **Not** idempotent — a retry after state change legitimately yields a different result.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tddTaskId` | `number` | Yes | TDD session ID |
| `goalId` | `number` | Yes | Goal this transition is for |
| `requestedPhase` | `string` | Yes | Target phase (`spike`, `red`, `red.triangulate`, `green`, `green.fake-it`, `refactor`, `extended-red`, `green-without-red`) |
| `citedArtifactId` | `number` | No | Evidence artifact ID (required for `red→green` and `green→refactor`) |
| `behaviorId` | `number` | No | Behavior this transition is for; triggers `pending→in_progress` auto-promotion on accept |
| `reason` | `string` | No | Free-text reason |

Returns `{ accepted: true, phase }` or `{ accepted: false, denialReason, remediation }`.

#### `tdd_goal`

Goal CRUD under a TDD session. Goals follow a closed status lifecycle: `pending → in_progress → done | abandoned`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `create`, `update`, `delete`, `get`, `list` |
| `sessionId` | `number` | `create`, `list` | TDD session ID |
| `goal` | `string` | `create` (input) / `update` (optional new text) | Goal text |
| `id` | `number` | `update`, `delete`, `get` | Goal ID |
| `status` | `string` | No | `update`: one of `pending`, `in_progress`, `done`, `abandoned` |

`create` is idempotent on `(sessionId, goal)` and returns the full `GoalRow`. `delete` cascades to behaviors, phases, and artifacts; it is reserved for the main agent under explicit user confirmation and denied to the TDD orchestrator subagent at the hook layer.

#### `tdd_behavior`

Behavior CRUD under a goal. Behaviors follow the same closed status lifecycle as goals.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `string` | Yes | One of: `create`, `update`, `delete`, `get`, `list_by_goal`, `list_by_tdd_task` |
| `goalId` | `number` | `create`, `list_by_goal` | Parent goal ID |
| `sessionId` | `number` | `list_by_tdd_task` | TDD session ID |
| `behavior` | `string` | `create` (input) / `update` (optional new text) | Behavior text |
| `id` | `number` | `update`, `delete`, `get` | Behavior ID |
| `suggestedTestName` | `string` | No | `create` / `update`: suggested test name |
| `status` | `string` | No | `update`: one of `pending`, `in_progress`, `done`, `abandoned` |
| `dependsOnBehaviorIds` | `number[]` | No | `create` / `update`: IDs of behaviors this one depends on (must belong to the same goal) |

`create` is idempotent on `(goalId, behavior)` and returns the full `BehaviorRow`. `update` replaces the full dependency set in one transaction when `dependsOnBehaviorIds` is provided. `delete` cascades to phases and artifacts; same hook-layer restriction as `tdd_goal.delete`.

#### `tdd_artifact_list`

List TDD artifacts (test files, runs, hypotheses) recorded by the plugin's post-tool-use hook for a session.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tddTaskId` | `number` | Yes | TDD session ID |

### Workspace history

#### `commit_changes`

Workspace git commit history joined with per-run changed files.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sha` | `string` | No | Specific commit SHA to look up; omit for the 20 most recent |

## Notes System

Notes persist debugging findings, test observations, and planning context
across sessions. They are stored in the same SQLite database as test data.

### Scopes

| Scope | Use Case |
| --- | --- |
| `global` | Project-wide observations |
| `project` | Scoped to a Vitest project |
| `module` | Scoped to a test file |
| `suite` | Scoped to a test suite |
| `test` | Scoped to an individual test |
| `note` | Reply to another note (threaded) |

### Best practices

- Use `note` action `create` to record debugging findings for future sessions
- Use `note` action `search` to check for existing context before investigating a test failure
- Use `pinned: true` for important notes that should not be missed
- Use `expiresAt` for temporary notes (e.g., "skip this test until fix is deployed")
- Use the `note` scope with `parentNoteId` for threaded discussions on a finding

### Example workflow

```text
Agent: test_history shows test X is flaky

Agent: note { action: "search", query: "test X" } finds a note from a previous session:
  "Flaky due to race condition in async setup. Wrapping in retry
   workaround until #123 is merged."

Agent: skips investigation, focuses on other failures
```

## Resources

The server exposes four resources under two URI schemes. All resources return `text/markdown`.

| URI | Description |
| --- | --- |
| `vitest://docs/` | Index of the vendored Vitest documentation snapshot |
| `vitest://docs/{path}` | Any page from the snapshot (e.g., `vitest://docs/api/mock`) |
| `vitest-agent://patterns/` | Index of the curated testing-patterns library |
| `vitest-agent://patterns/{slug}` | A single pattern by slug |

`vitest://` content is a vendored MIT-licensed snapshot of `vitest-dev/vitest` at a pinned upstream tag. `vendor/vitest-docs/manifest.json` carries `tag`, `commitSha`, `capturedAt` and `source` for verification; `vendor/vitest-docs/ATTRIBUTION.md` carries the MIT-license attribution.

`vitest-agent://` content is project-authored: a curated testing-patterns library encoding guidance for testing Effect services, Effect schemas, and custom reporters.

## Prompts

MCP clients can pick these from a prompt menu to orient the agent toward common workflows. Each prompt emits a small templated user message — no tool data is pre-fetched on the server. The agent fetches data via tools after the prompt orients it.

| Name | Arguments | Description |
| --- | --- | --- |
| `triage` | `project?` | Orient toward a failure-triage workflow; composes `triage_brief`, `failure_signature_get` and `hypothesis` (action `record`) |
| `why-flaky` | `test`, `project?` | Diagnose a named flaky test; composes `test_history` and `failure_signature_get` |
| `regression-since-pass` | `test`, `project?` | Find the change that broke a test; composes `test_history`, `commit_changes` and `turn_search` |
| `explain-failure` | `signature` | Synthesize a root cause from a failure signature's recurrence history |
| `tdd-resume` | `chat_id?` | Resume the active TDD session from its current phase and iron-law transitions |
| `wrapup` | `kind?`, `since?` | Generate the same content the post-hooks emit automatically |

The `kind` argument on `wrapup` accepts the same five values the `wrapup_prompt` tool accepts: `stop`, `session_end`, `pre_compact`, `tdd_handoff` and `user_prompt_nudge`.

## Refreshing the snapshot

Contributors can update the vendored Vitest documentation to a new upstream release:

```bash
pnpm run update-vitest-snapshot --tag v4.3.0
# example output (varies by environment)
```

Run this command from the `packages/mcp/` directory. It sparse-clones `vitest-dev/vitest` at the requested tag, rewrites `vendor/vitest-docs/`, and updates `manifest.json`. The `update-vitest-snapshot` Claude Code skill wraps this command and walks through the steps interactively.
