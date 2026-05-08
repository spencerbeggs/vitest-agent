import { publicProcedure } from "../context.js";

const HELP_TEXT = `# vitest-agent MCP Tools

> 54 tools total (53 tRPC procedures + \`tdd_progress_push\` registered directly on the MCP server).

## General

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`help\` | _(none)_ | List all available MCP tools with parameters |
| \`ping\` | _(none)_ | Ping the MCP server — returns 'pong'. Used to verify hot-patch reload |

## Test Data

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`test_status\` | \`project?\` | Per-project test pass/fail state |
| \`test_overview\` | \`project?\` | Test landscape with run metrics |
| \`test_get\` | \`fullName\`, \`project?\` | Single test drill-down: state, errors, history, classification |
| \`test_coverage\` | \`project?\` | Coverage gaps with uncovered lines |
| \`file_coverage\` | \`filePath\`, \`project?\` | Per-file coverage with uncovered lines and related tests |
| \`test_history\` | \`project\` | Flaky/persistent/recovered tests |
| \`test_trends\` | \`project\`, \`limit?\` | Coverage trajectory over time |
| \`test_errors\` | \`project\`, \`errorName?\` | Errors with diffs and stacks |
| \`test_for_file\` | \`filePath\` | Tests covering a source file |

## Discovery

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`project_list\` | _(none)_ | All projects with latest run summary |
| \`test_list\` | \`project?\`, \`state?\`, \`module?\`, \`limit?\` | Test cases with state and duration |
| \`module_list\` | \`project?\` | Test modules (files) with test counts |
| \`suite_list\` | \`project?\`, \`module?\` | Test suites (describe blocks) |
| \`settings_list\` | _(none)_ | Vitest config snapshots |

## Execution

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`run_tests\` | \`files?\`, \`project?\`, \`timeout?\` | Run vitest with optional filters |

Scopes: \`run_tests({})\` all tests, \`run_tests({ project: "name" })\` by project, \`run_tests({ files: ["path"] })\` specific files.

## Diagnostics

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`cache_health\` | _(none)_ | Database health and staleness check |
| \`configure\` | \`settingsHash?\` | View captured Vitest settings |

## Notes

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`note_create\` | \`title\`, \`content\`, \`scope\`, \`project?\`, \`testFullName?\`, \`modulePath?\`, \`parentNoteId?\`, \`createdBy?\`, \`expiresAt?\`, \`pinned?\` | Create a scoped note |
| \`note_list\` | \`scope?\`, \`project?\`, \`testFullName?\` | List notes with filters |
| \`note_get\` | \`id\` | Get a note by ID |
| \`note_update\` | \`id\`, \`title?\`, \`content?\`, \`pinned?\`, \`expiresAt?\` | Update a note |
| \`note_delete\` | \`id\` | Delete a note |
| \`note_search\` | \`query\` | Full-text search notes |

## Sessions / Turns / TDD reads (β)

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`session_list\` | \`project?\`, \`agentKind?\`, \`limit?\` | List recorded Claude Code sessions |
| \`session_get\` | \`id\` | Full detail for one session by integer id |
| \`turn_search\` | \`sessionId?\`, \`since?\`, \`type?\`, \`limit?\` | Search turns (default limit 100) |
| \`failure_signature_get\` | \`hash\` | Stable failure signature with recent example errors |
| \`tdd_session_get\` | \`id\` | TDD session with phases and artifacts rolled up |
| \`hypothesis_list\` | \`sessionId?\`, \`outcome?\`, \`limit?\` | List recorded hypotheses (\`outcome=open\` for unvalidated) |
| \`acceptance_metrics\` | _(none)_ | Four spec Annex A acceptance metrics |
| \`triage_brief\` | \`project?\`, \`maxLines?\` | Orientation triage: failing tests, flaky tests, open TDD sessions, next actions |

## Hypothesis writes (RC)

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`hypothesis_record\` | \`sessionId\`, \`content\`, \`createdTurnId?\`, \`citedTestErrorId?\`, \`citedStackFrameId?\` | Record an agent hypothesis; returns \`{ id }\` |
| \`hypothesis_validate\` | \`id\`, \`outcome\`, \`validatedAt\`, \`validatedTurnId?\` | Record validation outcome for a hypothesis; returns \`{}\` |

## Wrap-up prompts (RC)

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`wrapup_prompt\` | \`sessionId?\`, \`ccSessionId?\`, \`kind?\`, \`userPromptHint?\` | Tailored wrap-up prompt for a session (Stop / SessionEnd / PreCompact / TDD handoff / UserPromptSubmit nudge variants) |

## TDD lifecycle (final)

- tdd_session_start — open a TDD session for a goal (idempotent on sessionId+goal)
- tdd_session_end — close a TDD session with succeeded/blocked/abandoned (idempotent on tddSessionId+outcome)
- tdd_session_resume — markdown digest of an open session for resume context
- tdd_phase_transition_request — request a phase transition with cited artifact (validates D2 binding rules; auto-promotes behavior pending → in_progress on accept)
- tdd_goal_create — create a goal under a TDD session (idempotent on sessionId+goal)
- tdd_goal_get — read one goal with its nested behaviors
- tdd_goal_update — update a goal's text and/or status (lifecycle: pending → in_progress → done | abandoned)
- tdd_goal_delete — hard-delete a goal (cascades; reserved for cleanup of mistakes)
- tdd_goal_list — list goals for a session with nested behaviors
- tdd_behavior_create — create a behavior under a goal (idempotent on goalId+behavior; optional dependsOnBehaviorIds)
- tdd_behavior_get — read one behavior with parent goal summary and dependencies
- tdd_behavior_update — update a behavior's text, status, or dependency set
- tdd_behavior_delete — hard-delete a behavior (cascades; reserved for cleanup of mistakes)
- tdd_behavior_list — list behaviors by goal or session (discriminated input)
- tdd_progress_push — push a TDD progress event to the main agent via Claude Code channels (best-effort; no-op when channels are inactive)

## Workspace history (final)

- commit_changes — commit metadata + changed files (populated by post-commit hook)

## MCP-server session-id association

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`get_current_session_id\` | _(none)_ | Read the Claude Code session id this MCP server process is currently associated with |
| \`set_current_session_id\` | \`id\` (string or null) | Associate this MCP server process with a Claude Code session id; session-aware tools default to it when \`ccSessionId\` is omitted. Pass \`null\` to clear |

## Parameter Key

- **Required** parameters are unmarked
- **Optional** parameters have \`?\` suffix
- \`project\` filters to a Vitest project name
- \`state\` accepts: \`passed\`, \`failed\`, \`skipped\`, \`pending\`
- \`scope\` accepts: \`global\`, \`project\`, \`module\`, \`suite\`, \`test\`, \`note\`
`;

export const help = publicProcedure.query(() => HELP_TEXT);
