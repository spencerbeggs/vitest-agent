import { Schema } from "effect";
import { publicProcedure } from "../context.js";

export const HelpResult = Schema.Struct({
	helpText: Schema.String.annotations({
		description: "Markdown table of every MCP tool with parameters and a one-line description.",
	}),
}).annotations({
	identifier: "HelpResult",
	title: "help result",
	description:
		"Static help reference. Read structuredContent.helpText programmatically; the same string lives in content[].text for transcripts.",
});
export type HelpResultType = Schema.Schema.Type<typeof HelpResult>;

const HELP_TEXT = `# vitest-agent MCP Tools

> Consolidated tool surface (Phase 3 of the agent-agnostic taxonomy).
> Action-keyed tools collapse the prior 5–6 CRUD families into one tool
> per noun: \`hypothesis\`, \`note\`, \`inventory\`, \`test\`,
> \`tdd_goal\`, \`tdd_behavior\`, \`tdd_task\`.

## General

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`help\` | _(none)_ | List all available MCP tools with parameters |
| \`ping\` | _(none)_ | Ping the MCP server — returns 'pong'. Used to verify hot-patch reload |

## Test Data (read-only)

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`test_status\` | \`project?\` | Per-project test pass/fail state |
| \`test_overview\` | \`project?\` | Test landscape with run metrics |
| \`test_coverage\` | \`project?\` | Coverage gaps with uncovered lines |
| \`file_coverage\` | \`filePath\`, \`project?\` | Per-file coverage with uncovered lines and related tests |
| \`test_history\` | \`project\` | Flaky/persistent/recovered tests |
| \`test_trends\` | \`project\`, \`limit?\` | Coverage trajectory over time |
| \`test_errors\` | \`project\`, \`errorName?\`, \`format?\` (\`markdown\` \\| \`xml\`) | Errors with diffs, stacks, and the cite-able \`testErrorId\` / \`topStackFrameId\` values needed by \`hypothesis (action: record)\` |
| \`test\` | \`action\` (\`list\`/\`get\`/\`for_file\`), plus per-action params | Consolidated test inspection: list/get/for_file |

\`test\` actions:
- \`{ action: "list", project?, state?, module?, limit? }\`
- \`{ action: "get", fullName, project? }\`
- \`{ action: "for_file", filePath }\`

## Discovery

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`inventory\` | \`kind\` (\`project\`/\`module\`/\`suite\`/\`session\`), plus per-kind params | Consolidated entity discovery |
| \`settings_list\` | _(none)_ | Vitest config snapshots |

\`inventory\` kinds:
- \`{ kind: "project" }\`
- \`{ kind: "module", project? }\`
- \`{ kind: "suite", project?, module? }\`
- \`{ kind: "session", project?, agentKind?, limit? }\` (omit \`id\` to list)
- \`{ kind: "session", id }\` (single-session detail)

## Execution

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`run_tests\` | \`files?\`, \`project?\`, \`timeout?\`, \`format?\` | Run vitest with optional filters |
| \`register_agent\` | \`sessionId\`, \`agentType\`, \`hostKind?\`, \`parentAgentId?\`, \`clientNonce?\`, \`startGitBranch?\`, \`startGitCommitSha?\`, \`startWorktreeDir?\` | Idempotent agent invocation registration |

## Diagnostics

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`cache_health\` | _(none)_ | Database health and staleness check |
| \`configure\` | \`settingsHash?\` | View captured Vitest settings |
| \`failure_signature_get\` | \`hash\` | Stable failure signature with recent example errors |
| \`turn_search\` | \`sessionId?\`, \`since?\`, \`type?\`, \`limit?\` | Search turns (default limit 100) |
| \`acceptance_metrics\` | _(none)_ | Four spec Annex A acceptance metrics |
| \`triage_brief\` | \`project?\`, \`maxLines?\` | Orientation triage |
| \`wrapup_prompt\` | \`sessionId?\`, \`chatId?\`, \`kind?\`, \`userPromptHint?\` | Tailored wrap-up prompt |
| \`commit_changes\` | \`sha?\` | Commit metadata + changed files |

## Notes

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`note\` | \`action\` (\`create\`/\`list\`/\`get\`/\`update\`/\`delete\`/\`search\`), plus per-action params | Consolidated note CRUD with FTS5 search |

\`note\` actions:
- \`{ action: "create", title, content, scope, project?, testFullName?, modulePath?, parentNoteId?, createdBy?, expiresAt?, pinned? }\`
- \`{ action: "list", scope?, project?, testFullName? }\`
- \`{ action: "get", id }\`
- \`{ action: "update", id, title?, content?, pinned?, expiresAt? }\`
- \`{ action: "delete", id }\`
- \`{ action: "search", query }\`

## Hypotheses

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`hypothesis\` | \`action\` (\`record\`/\`validate\`/\`list\`), plus per-action params | Consolidated hypothesis surface |

\`hypothesis\` actions:
- \`{ action: "record", sessionId, content, createdTurnId?, citedTestErrorId?, citedStackFrameId? }\`
- \`{ action: "validate", id, outcome, validatedAt, validatedTurnId? }\`
- \`{ action: "list", sessionId?, outcome?, limit? }\`

## TDD lifecycle

| Tool | Parameters | Description |
| ---- | ---------- | ----------- |
| \`tdd_task\` | \`action\` (\`start\`/\`end\`/\`get\`/\`resume\`), plus per-action params | TDD task lifecycle |
| \`tdd_goal\` | \`action\` (\`create\`/\`update\`/\`delete\`/\`get\`/\`list\`), plus per-action params | Goals under a TDD task |
| \`tdd_behavior\` | \`action\` (\`create\`/\`update\`/\`delete\`/\`get\`/\`list_by_goal\`/\`list_by_tdd_task\`), plus per-action params | Behaviors under a goal |
| \`tdd_artifact_list\` | \`tddTaskId\`, \`artifactKind?\`, \`phaseId?\`, \`behaviorId?\`, \`limit?\`, \`format?\` | List recorded TDD artifacts (newest first); use to find the artifact id to cite in \`tdd_phase_transition_request\` |
| \`tdd_phase_transition_request\` | \`tddTaskId\`, \`goalId\`, \`requestedPhase\`, \`citedArtifactId?\`, \`citedArtifactKind?\`, \`behaviorId?\`, \`reason?\` | Request a phase transition; validates D2 binding rules. \`citedArtifactId\` is optional — when omitted, the most recent matching artifact (kind from \`citedArtifactKind\` or the transition's required-evidence rule) is auto-resolved |
| \`tdd_progress_push\` | \`payload\` | Push a TDD progress event to the main agent (best-effort) |

\`tdd_task\` actions:
- \`{ action: "start", goal, sessionId|chatId, parentTddTaskId?, startedAt?, runId? }\`
- \`{ action: "end", tddTaskId, outcome, summaryNoteId? }\`
- \`{ action: "get", tddTaskId }\`
- \`{ action: "resume", tddTaskId }\`

\`tdd_goal\` actions:
- \`{ action: "create", tddTaskId, goal }\`
- \`{ action: "update", id, goal?, status? }\`
- \`{ action: "delete", id }\`
- \`{ action: "get", id }\`
- \`{ action: "list", tddTaskId }\`

\`tdd_behavior\` actions:
- \`{ action: "create", goalId, behavior, suggestedTestName?, dependsOnBehaviorIds? }\`
- \`{ action: "update", id, behavior?, suggestedTestName?, status?, dependsOnBehaviorIds? }\`
- \`{ action: "delete", id }\`
- \`{ action: "get", id }\`
- \`{ action: "list_by_goal", goalId }\`
- \`{ action: "list_by_tdd_task", tddTaskId }\`

## Parameter Key

- **Required** parameters are unmarked
- **Optional** parameters have \`?\` suffix
- \`project\` filters to a Vitest project name
- \`state\` accepts: \`passed\`, \`failed\`, \`skipped\`, \`pending\`
- \`scope\` accepts: \`global\`, \`project\`, \`module\`, \`suite\`, \`test\`, \`note\`
`;

export const help = publicProcedure.query((): HelpResultType => ({ helpText: HELP_TEXT }));
