# MCP Server

The `vitest-agent-mcp` binary provides an
[MCP](https://modelcontextprotocol.io/) server over stdio transport,
exposing 52 tools for querying test data, managing notes, running
tests, discovering project structure, and managing TDD goals and
behaviors. The server also exposes four resources (vendored Vitest docs and curated testing patterns) and six framing-only prompts for common workflows. LLM agent hosts like Claude Code can call these tools directly during a session.

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

## Tool Reference

### Help

#### `help`

List all available MCP tools with their parameters and descriptions.

No parameters. Returns a complete tool catalog organized by category.

### Read-Only Tools

These tools query the SQLite database and return markdown-formatted
results.

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

Flaky tests, persistent failures, and recovered tests with run
visualization.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | Yes | Project name |

#### `test_trends`

Per-project coverage trend with direction, metrics, and sparkline
trajectory.

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

#### `test_for_file`

Find test modules that cover a given source file.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | `string` | Yes | Source file path to find tests for |

#### `test_get`

Read a single test case in detail: state, duration, errors, history,
and classification.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `fullName` | `string` | Yes | Full test name (`Suite > nested > test`) |
| `project` | `string` | No | Project name |

#### `file_coverage`

Per-file coverage with uncovered line ranges and the test modules that
cover the file.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | `string` | Yes | Source file path to look up |

#### `configure`

View captured Vitest settings for a test run.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `settingsHash` | `string` | No | Settings hash from a manifest entry or test run |

#### `cache_health`

Database health diagnostic: manifest presence, project states, staleness.

No parameters.

### Mutation Tools

#### `run_tests`

Execute vitest for specific files or patterns.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | `string[]` | No | Test file paths to run |
| `project` | `string` | No | Project name to filter |
| `timeout` | `number` | No | Timeout in seconds (default: 120) |
| `format` | `string` | No | Output format: `"markdown"` (default) or `"json"` |

Returns a markdown digest when `format` is `"markdown"`. When `format` is
`"json"`, the tool returns a JSON object wrapper: on success,
`{ report, classifications? }`; on failure, `{ error, ... }`.

### Discovery Tools

These tools help agents explore the test landscape and project structure.

#### `project_list`

List all projects with their latest run summary.

No parameters.

#### `test_list`

List test cases with state and duration.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Project name |
| `state` | `string` | No | Filter by state (`passed`, `failed`, `skipped`, `pending`) |
| `module` | `string` | No | Filter by module file path |
| `limit` | `number` | No | Max number of results |

#### `module_list`

List test modules (files) with test counts.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Project name |

#### `suite_list`

List test suites (describe blocks).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Project name |
| `module` | `string` | No | Filter by module file path |

#### `settings_list`

List all captured Vitest config snapshots with their hashes.

No parameters.

### Note Tools

The notes system provides CRUD operations and full-text search for
persisting debugging notes across sessions. Notes can be scoped to a
project, module, suite, test, or left as free-form.

#### `note_create`

Create a scoped note.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | `string` | Yes | Note title |
| `content` | `string` | Yes | Note content (markdown supported) |
| `scope` | `string` | Yes | One of: `global`, `project`, `module`, `suite`, `test`, `note` |
| `project` | `string` | No | Project name (for project/module/suite/test scopes) |
| `testFullName` | `string` | No | Full test name (for test scope) |
| `modulePath` | `string` | No | Module file path (for module scope) |
| `parentNoteId` | `number` | No | Parent note ID for threading |
| `createdBy` | `string` | No | Creator identifier |
| `expiresAt` | `string` | No | ISO 8601 expiration timestamp |
| `pinned` | `boolean` | No | Pin the note |

Returns `{ id: number }` with the created note ID.

#### `note_list`

List notes with optional filters.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `scope` | `string` | No | Filter by scope |
| `project` | `string` | No | Filter by project |
| `testFullName` | `string` | No | Filter by test full name |

Returns an array of note objects.

#### `note_get`

Read a note by ID.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Note ID |

Returns the note object or null.

#### `note_update`

Update an existing note.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Note ID to update |
| `title` | `string` | No | New title |
| `content` | `string` | No | New content |
| `pinned` | `boolean` | No | Pin or unpin |
| `expiresAt` | `string` | No | New expiration (ISO 8601) |

Returns `{ success: true }`.

#### `note_delete`

Delete a note by ID.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Note ID to delete |

Returns `{ success: true }`.

#### `note_search`

Full-text search across note titles and content.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | `string` | Yes | Search query |

Returns an array of matching note objects.

### Session and Turn Tools

These tools expose the Claude Code session and turn log recorded by the
plugin hooks.

#### `session_list`

List Claude Code sessions.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Filter by project name |
| `agentKind` | `string` | No | Filter by kind: `"main"` or `"subagent"` |
| `limit` | `number` | No | Max results (default: 50) |

#### `session_get`

Read a single Claude Code session by database ID.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Session database ID |

#### `turn_search`

Search the turn log for a session.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | No | Filter by session ID |
| `type` | `string` | No | Filter by turn type (`user_prompt`, `tool_call`, `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`) |
| `since` | `string` | No | ISO 8601 lower-bound timestamp |
| `limit` | `number` | No | Max results (default: 50) |

#### `failure_signature_get`

Read a failure signature by its hash, including up to 10 recent matching
test errors.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `hash` | `string` | Yes | 16-char hex signature hash |

#### `acceptance_metrics`

Compute the four acceptance-quality ratios: phase-evidence integrity,
compliance-hook responsiveness, orientation usefulness, and anti-pattern
detection rate.

No parameters.

### Triage and Wrap-Up Tools

#### `triage_brief`

Orientation summary for a new session: recent run status, open failures,
and triage context.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | `string` | No | Filter to a specific project |
| `maxLines` | `number` | No | Max lines in the output |

#### `wrapup_prompt`

Interpretive wrap-up nudge injected by Stop, SessionEnd, PreCompact, and
UserPromptSubmit hooks.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `ccSessionId` | `string` | No | Claude Code session ID |
| `kind` | `string` | No | One of: `stop`, `session_end`, `pre_compact`, `tdd_handoff`, `user_prompt_nudge` |
| `userPromptHint` | `string` | No | Prompt text for `user_prompt_nudge` variant |

### Hypothesis Tools

Hypothesis writes go through the tRPC idempotency middleware so duplicate
calls from a retrying agent replay the cached response instead of
double-writing.

#### `hypothesis_record`

Record a new agent hypothesis with optional evidence links.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | Yes | Database session ID |
| `content` | `string` | Yes | Hypothesis text |
| `citedTestErrorId` | `number` | No | `test_errors.id` FK |
| `citedStackFrameId` | `number` | No | `stack_frames.id` FK |
| `createdTurnId` | `number` | No | `turns.id` FK |

Returns `{ id: number }`.

#### `hypothesis_validate`

Update a hypothesis outcome.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Hypothesis ID |
| `outcome` | `string` | Yes | One of: `confirmed`, `refuted`, `abandoned` |
| `validatedAt` | `string` | Yes | ISO 8601 timestamp |
| `validatedTurnId` | `number` | No | `turns.id` FK |

#### `hypothesis_list`

List hypotheses with optional filters.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | No | Filter by session |
| `outcome` | `string` | No | Filter by outcome (`confirmed`, `refuted`, `abandoned`, `open`) |
| `limit` | `number` | No | Max results (default: 50) |

### TDD Lifecycle Tools

These tools drive the TDD orchestrator subagent's state machine. Write
tools go through idempotency middleware where appropriate.

#### `tdd_session_start`

Open a new TDD session with a goal. Idempotent on `(sessionId, goal)`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `goal` | `string` | Yes | TDD session goal |
| `sessionId` | `number` | No | Database session ID (use when `ccSessionId` is unavailable) |
| `ccSessionId` | `string` | No | Claude Code session ID |
| `parentTddSessionId` | `number` | No | Parent TDD session for delegation |
| `startedAt` | `string` | No | ISO 8601 timestamp (defaults to now) |

Returns `{ id: number }`.

#### `tdd_session_end`

Close a TDD session. Idempotent on `(tddSessionId, outcome)`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tddSessionId` | `number` | Yes | TDD session ID |
| `outcome` | `string` | Yes | One of: `succeeded`, `blocked`, `abandoned` |
| `summaryNoteId` | `number` | No | Optional note FK |

#### `tdd_session_resume`

Get a markdown digest of an open TDD session.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | TDD session ID |

#### `tdd_session_get`

Read a TDD session with all its phases, artifacts, and — when goal and
behavior rows exist — a Goals and Behaviors section listing each goal
with its ordinal and status alongside its nested behaviors.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | TDD session ID |

#### `tdd_phase_transition_request`

Request a TDD phase transition. Pre-checks goal status and behavior
membership, then validates the cited evidence artifact against the three
D2 binding rules before writing the new phase row. When accepted with a
`behaviorId`, auto-promotes that behavior from `pending` to
`in_progress`. Transitions to `green` from any phase other than `red`,
`red.triangulate`, or `green.fake-it` are rejected with
`wrong_source_phase` — the `red` phase must be entered explicitly first.
**Not** idempotent — a retry after state change legitimately yields a
different result.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tddSessionId` | `number` | Yes | TDD session ID |
| `goalId` | `number` | Yes | Goal this transition is for |
| `requestedPhase` | `string` | Yes | Target phase (`spike`, `red`, `red.triangulate`, `green`, `green.fake-it`, `refactor`, `extended-red`, `green-without-red`) |
| `citedArtifactId` | `number` | No | Evidence artifact ID (required for `red→green` and `green→refactor`) |
| `behaviorId` | `number` | No | Behavior this transition is for; triggers `pending→in_progress` auto-promotion on accept |
| `reason` | `string` | No | Free-text reason |

Returns `{ accepted: true, phase }` or
`{ accepted: false, denialReason, remediation }`.

### TDD Goal Tools

The three-tier Objective→Goal→Behavior hierarchy lets the TDD
orchestrator decompose a session objective into goals and each goal into
atomic behaviors. Goal and behavior CRUD tools are idempotent on creation
and follow a closed status lifecycle: `pending → in_progress →
done | abandoned`.

#### `tdd_goal_create`

Create a goal under a TDD session. Idempotent on `(sessionId, goal)`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | Yes | TDD session ID |
| `goal` | `string` | Yes | Goal text |

Returns the full `GoalRow`.

#### `tdd_goal_get`

Read a goal with nested behaviors.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Goal ID |

#### `tdd_goal_update`

Update a goal's text or status. Status must follow the closed lifecycle;
illegal transitions return an error.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Goal ID |
| `goal` | `string` | No | New goal text |
| `status` | `string` | No | One of: `pending`, `in_progress`, `done`, `abandoned` |

#### `tdd_goal_delete`

Hard-delete a goal and cascade to its behaviors, phases, and artifacts.
Reserved for the main agent under explicit user confirmation; denied to
the TDD orchestrator subagent at the hook layer.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Goal ID |

#### `tdd_goal_list`

List goals for a session with nested behaviors, ordered by ordinal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sessionId` | `number` | Yes | TDD session ID |

### TDD Behavior Tools

#### `tdd_behavior_create`

Create a behavior under a goal. Idempotent on `(goalId, behavior)`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `goalId` | `number` | Yes | Parent goal ID |
| `behavior` | `string` | Yes | Behavior text |
| `suggestedTestName` | `string` | No | Suggested test name |
| `dependsOnBehaviorIds` | `number[]` | No | IDs of behaviors this one depends on (must belong to the same goal) |

Returns the full `BehaviorRow`.

#### `tdd_behavior_get`

Read a behavior with its parent goal summary and resolved dependencies.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Behavior ID |

#### `tdd_behavior_update`

Update a behavior's text, suggested test name, status, or dependencies.
Replacing `dependsOnBehaviorIds` swaps the full dependency set in one
transaction.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Behavior ID |
| `behavior` | `string` | No | New behavior text |
| `suggestedTestName` | `string` | No | New suggested test name |
| `status` | `string` | No | One of: `pending`, `in_progress`, `done`, `abandoned` |
| `dependsOnBehaviorIds` | `number[]` | No | Replacement dependency set |

#### `tdd_behavior_delete`

Hard-delete a behavior and cascade to its phases and artifacts. Reserved
for the main agent under explicit user confirmation; denied to the TDD
orchestrator subagent at the hook layer.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | Behavior ID |

#### `tdd_behavior_list`

List behaviors by goal or session.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `scope` | `string` | Yes | One of: `goal`, `session` |
| `goalId` | `number` | No | Required when `scope` is `"goal"` |
| `sessionId` | `number` | No | Required when `scope` is `"session"` |

### Workspace History Tools

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

### Best Practices

- Use `note_create` to record debugging findings for future sessions
- Use `note_search` to check for existing context before investigating
  a test failure
- Use `pinned: true` for important notes that should not be missed
- Use `expiresAt` for temporary notes (e.g., "skip this test until fix
  is deployed")
- Use the `note` scope with `parentNoteId` for threaded discussions on
  a finding

### Example Workflow

```text
Agent: "test_history" shows test X is flaky

Agent: "note_search" for test X -- finds note from previous session:
  "Flaky due to race condition in async setup. Wrapping in retry
   workaround until #123 is merged."

Agent: Skips investigation, focuses on other failures
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
| `triage` | `project?` | Orient toward a failure-triage workflow; composes `triage_brief`, `failure_signature_get` and `hypothesis_record` |
| `why-flaky` | `test`, `project?` | Diagnose a named flaky test; composes `test_history` and `failure_signature_get` |
| `regression-since-pass` | `test`, `project?` | Find the change that broke a test; composes `test_history`, `commit_changes` and `turn_search` |
| `explain-failure` | `signature` | Synthesize a root cause from a failure signature's recurrence history |
| `tdd-resume` | `cc_session_id?` | Resume the active TDD session from its current phase and iron-law transitions |
| `wrapup` | `kind?`, `since?` | Generate the same content the post-hooks emit automatically |

The `kind` argument on `wrapup` accepts the same five values the `wrapup_prompt` tool accepts: `stop`, `session_end`, `pre_compact`, `tdd_handoff` and `user_prompt_nudge`.

## Refreshing the snapshot

Contributors can update the vendored Vitest documentation to a new upstream release:

```bash
pnpm run update-vitest-snapshot --tag v4.3.0
# example output (varies by environment)
```

Run this command from the `packages/mcp/` directory. It sparse-clones `vitest-dev/vitest` at the requested tag, rewrites `vendor/vitest-docs/`, and updates `manifest.json`. The `update-vitest-snapshot` Claude Code skill wraps this command and walks through the steps interactively.
