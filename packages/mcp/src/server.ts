import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Option, Schema } from "effect";
import { ChannelEvent, DataReader } from "vitest-agent-sdk";
import { z } from "zod";
import type { McpContext } from "./context.js";
import { createCallerFactory } from "./context.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";
import { appRouter } from "./router.js";

/**
 * For behavior-scoped events, resolve goalId/sessionId server-side from
 * behaviorId so a stale orchestrator context cannot push the wrong tree
 * coordinates. Goal-scoped events get sessionId resolved from goalId.
 * Returns the enriched event object or the original on resolution failure.
 */
async function resolveChannelEvent(ctx: McpContext, raw: unknown): Promise<unknown> {
	const decoded = Schema.decodeUnknownEither(ChannelEvent)(raw);
	if (decoded._tag === "Left") {
		// Pass through invalid payloads — channel push is best-effort and
		// we don't want to break the orchestrator if a future event type
		// has not been added to the schema yet. The receiving main agent
		// will still parse the JSON and apply its own handler.
		return raw;
	}
	const event = decoded.right;
	return ctx.runtime.runPromise(
		Effect.gen(function* () {
			const reader = yield* DataReader;
			switch (event.type) {
				case "behavior_started":
				case "phase_transition":
				case "behavior_completed":
				case "behavior_abandoned":
				case "blocked": {
					const goalIdOpt = yield* reader.resolveGoalIdForBehavior(event.behaviorId);
					if (Option.isNone(goalIdOpt)) return event;
					const goalDetailOpt = yield* reader.getGoalById(goalIdOpt.value);
					if (Option.isNone(goalDetailOpt)) return event;
					return { ...event, goalId: goalIdOpt.value, sessionId: goalDetailOpt.value.sessionId };
				}
				case "goal_started":
				case "goal_completed":
				case "goal_abandoned": {
					const goalDetailOpt = yield* reader.getGoalById(event.goalId);
					if (Option.isNone(goalDetailOpt)) return event;
					return { ...event, sessionId: goalDetailOpt.value.sessionId };
				}
				default:
					return event;
			}
		}),
	);
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export async function startMcpServer(ctx: McpContext): Promise<void> {
	const server = new McpServer(
		{
			name: "vitest-agent",
			version: "0.1.0",
		},
		{
			capabilities: {
				experimental: {
					// Declare Claude Code's channel capability so it routes
					// elicitation hook responses back to this server process.
					"claude/channel": {},
				},
			},
		},
	);

	const factory = createCallerFactory(appRouter);
	const caller = factory(ctx);

	// ── Help tool ──────────────────────────────────────────────────────

	server.registerTool(
		"help",
		{
			description: "List all available MCP tools with their parameters and descriptions",
		},
		async () => textResult(await caller.help()),
	);

	// ── Read-only tools (queries returning markdown) ────────────────────

	server.registerTool(
		"test_status",
		{
			description: "Per-project test pass/fail state from the most recent run",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
		},
		async (args) => textResult(await caller.test_status({ project: args.project })),
	);

	server.registerTool(
		"test_overview",
		{
			description: "Test landscape summary with per-project run metrics",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
		},
		async (args) => textResult(await caller.test_overview({ project: args.project })),
	);

	server.registerTool(
		"test_coverage",
		{
			description: "Coverage gap analysis with per-metric thresholds and targets",
			inputSchema: {
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_coverage({
					project: args.project,
					subProject: args.subProject,
				}),
			),
	);

	server.registerTool(
		"test_history",
		{
			description: "Flaky tests, persistent failures, and recovered tests with run visualization",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_history({
					project: args.project,
					subProject: args.subProject,
				}),
			),
	);

	server.registerTool(
		"test_trends",
		{
			description: "Per-project coverage trend with direction, metrics, and sparkline trajectory",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
				limit: z.optional(z.coerce.number()).describe("Max number of trend entries to return"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_trends({
					project: args.project,
					subProject: args.subProject,
					limit: args.limit,
				}),
			),
	);

	server.registerTool(
		"test_errors",
		{
			description: "Detailed test errors with diffs and stack traces for a project",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
				subProject: z.optional(z.nullable(z.string())).describe("Sub-project name"),
				errorName: z.optional(z.string()).describe("Filter to a specific error name"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_errors({
					project: args.project,
					subProject: args.subProject,
					errorName: args.errorName,
				}),
			),
	);

	server.registerTool(
		"test_for_file",
		{
			description: "Find test modules that cover a given source file",
			inputSchema: {
				filePath: z.string().describe("Source file path to find tests for"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_for_file({
					filePath: args.filePath,
				}),
			),
	);

	server.registerTool(
		"test_get",
		{
			description:
				"Get detailed information about a single test: state, duration, errors, run history, and classification",
			inputSchema: {
				fullName: z.string().describe("Full test name (e.g. 'Suite > nested > test name')"),
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_get({
					fullName: args.fullName,
					project: args.project,
					subProject: args.subProject,
				}),
			),
	);

	server.registerTool(
		"file_coverage",
		{
			description:
				"Get coverage data for a specific source file: per-metric values, uncovered lines, and related tests",
			inputSchema: {
				filePath: z.string().describe("Source file path to check coverage for"),
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
			},
		},
		async (args) =>
			textResult(
				await caller.file_coverage({
					filePath: args.filePath,
					project: args.project,
					subProject: args.subProject,
				}),
			),
	);

	server.registerTool(
		"configure",
		{
			description: "View captured Vitest settings for a test run",
			inputSchema: {
				settingsHash: z.optional(z.string()).describe("Settings hash from a manifest entry or test run"),
			},
		},
		async (args) =>
			textResult(
				await caller.configure({
					settingsHash: args.settingsHash,
				}),
			),
	);

	server.registerTool(
		"cache_health",
		{
			description: "Cache health diagnostic: manifest presence, project states, staleness",
		},
		async () => textResult(await caller.cache_health()),
	);

	// ── Discovery tools (queries returning markdown tables) ─────────────

	server.registerTool(
		"project_list",
		{
			description: "List all projects with their latest run summary",
		},
		async () => textResult(await caller.project_list({})),
	);

	server.registerTool(
		"test_list",
		{
			description: "List test cases with optional filters for state, module, and limit",
			inputSchema: {
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
				state: z.optional(z.enum(["passed", "failed", "skipped", "pending"])).describe("Filter by test state"),
				module: z.optional(z.string()).describe("Filter by module file path"),
				limit: z.optional(z.coerce.number()).describe("Max number of results"),
			},
		},
		async (args) =>
			textResult(
				await caller.test_list({
					project: args.project,
					subProject: args.subProject,
					state: args.state,
					module: args.module,
					limit: args.limit,
				}),
			),
	);

	server.registerTool(
		"module_list",
		{
			description: "List test modules with state and test counts",
			inputSchema: {
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
			},
		},
		async (args) =>
			textResult(
				await caller.module_list({
					project: args.project,
					subProject: args.subProject,
				}),
			),
	);

	server.registerTool(
		"suite_list",
		{
			description: "List test suites with optional module filter",
			inputSchema: {
				project: z.optional(z.string()).describe("Project name"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
				module: z.optional(z.string()).describe("Filter by module file path"),
			},
		},
		async (args) =>
			textResult(
				await caller.suite_list({
					project: args.project,
					subProject: args.subProject,
					module: args.module,
				}),
			),
	);

	server.registerTool(
		"settings_list",
		{
			description: "List all captured settings snapshots with their hashes",
		},
		async () => textResult(await caller.settings_list({})),
	);

	// ── Mutation tools (return JSON) ────────────────────────────────────

	server.registerTool(
		"run_tests",
		{
			description: "Run Vitest tests with optional file and project filters",
			inputSchema: {
				files: z.optional(z.array(z.string())).describe("Test file paths to run"),
				project: z.optional(z.string()).describe("Project name to filter"),
				timeout: z.optional(z.coerce.number()).describe("Timeout in seconds (default: 120)"),
				format: z
					.optional(z.enum(["markdown", "json"]))
					.describe("Output format (default: markdown). 'json' returns the raw AgentReport for machine consumption."),
			},
		},
		async (args) =>
			textResult(
				await caller.run_tests({
					files: args.files,
					project: args.project,
					timeout: args.timeout,
					format: args.format,
				}),
			),
	);

	// ── Note CRUD tools ─────────────────────────────────────────────────

	server.registerTool(
		"note_create",
		{
			description: "Create a scoped note (global, project, module, suite, test, or free-form)",
			inputSchema: {
				title: z.string().describe("Note title"),
				content: z.string().describe("Note content (markdown supported)"),
				scope: z.enum(["global", "project", "module", "suite", "test", "note"]).describe("Note scope"),
				project: z.optional(z.string()).describe("Project name (for project/module/suite/test scopes)"),
				subProject: z.optional(z.string()).describe("Sub-project name"),
				testFullName: z.optional(z.string()).describe("Full test name (for test scope)"),
				modulePath: z.optional(z.string()).describe("Module file path (for module scope)"),
				parentNoteId: z.optional(z.coerce.number()).describe("Parent note ID for threading"),
				createdBy: z.optional(z.string()).describe("Creator identifier"),
				expiresAt: z.optional(z.string()).describe("ISO 8601 expiration timestamp"),
				pinned: z.optional(z.boolean()).describe("Pin the note"),
			},
		},
		async (args) => jsonResult(await caller.note_create(args)),
	);

	server.registerTool(
		"note_list",
		{
			description: "List notes with optional scope, project, and test filters",
			inputSchema: {
				scope: z.optional(z.string()).describe("Filter by scope"),
				project: z.optional(z.string()).describe("Filter by project"),
				testFullName: z.optional(z.string()).describe("Filter by test full name"),
			},
		},
		async (args) => textResult(await caller.note_list(args)),
	);

	server.registerTool(
		"note_get",
		{
			description: "Get a specific note by ID",
			inputSchema: {
				id: z.coerce.number().describe("Note ID"),
			},
		},
		async (args) => jsonResult(await caller.note_get({ id: args.id })),
	);

	server.registerTool(
		"note_update",
		{
			description: "Update an existing note's title, content, pin state, or expiration",
			inputSchema: {
				id: z.coerce.number().describe("Note ID to update"),
				title: z.optional(z.string()).describe("New title"),
				content: z.optional(z.string()).describe("New content"),
				pinned: z.optional(z.boolean()).describe("Pin or unpin"),
				expiresAt: z.optional(z.string()).describe("New expiration (ISO 8601)"),
			},
		},
		async (args) => jsonResult(await caller.note_update(args)),
	);

	server.registerTool(
		"note_delete",
		{
			description: "Delete a note by ID",
			inputSchema: {
				id: z.coerce.number().describe("Note ID to delete"),
			},
		},
		async (args) => jsonResult(await caller.note_delete({ id: args.id })),
	);

	server.registerTool(
		"note_search",
		{
			description: "Full-text search across note titles and content",
			inputSchema: {
				query: z.string().describe("Search query"),
			},
		},
		async (args) => textResult(await caller.note_search({ query: args.query })),
	);

	// ── Session & turn tools ────────────────────────────────────────────

	server.registerTool(
		"session_list",
		{
			description: "List Claude Code sessions recorded in the database",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
				agentKind: z.optional(z.enum(["main", "subagent"])).describe("Filter by agent kind"),
				limit: z.optional(z.coerce.number()).describe("Max sessions to return (default 50)"),
			},
		},
		async (args) =>
			textResult(
				await caller.session_list({
					project: args.project,
					agentKind: args.agentKind,
					limit: args.limit,
				}),
			),
	);

	server.registerTool(
		"session_get",
		{
			description: "Get details for a single Claude Code session by integer id",
			inputSchema: {
				id: z.coerce.number().describe("Session integer id"),
			},
		},
		async (args) => textResult(await caller.session_get({ id: args.id })),
	);

	server.registerTool(
		"turn_search",
		{
			description: "Search turn logs across sessions with optional filters",
			inputSchema: {
				sessionId: z.optional(z.coerce.number()).describe("Filter to a specific session id"),
				since: z.optional(z.string()).describe("ISO 8601 cutoff — return turns after this timestamp"),
				type: z
					.optional(z.enum(["user_prompt", "tool_call", "tool_result", "file_edit", "hook_fire", "note", "hypothesis"]))
					.describe("Filter by turn type"),
				limit: z.optional(z.coerce.number()).describe("Max turns to return (default 100)"),
			},
		},
		async (args) =>
			textResult(
				await caller.turn_search({
					sessionId: args.sessionId,
					since: args.since,
					type: args.type,
					limit: args.limit,
				}),
			),
	);

	// ── Failure signatures ──────────────────────────────────────────────

	server.registerTool(
		"failure_signature_get",
		{
			description: "Look up a failure signature by its 16-char sha256 hash",
			inputSchema: {
				hash: z.string().describe("16-char failure signature hash"),
			},
		},
		async (args) => textResult(await caller.failure_signature_get({ hash: args.hash })),
	);

	// ── TDD tools ───────────────────────────────────────────────────────

	server.registerTool(
		"tdd_session_get",
		{
			description: "Get details for a TDD session including phases and artifacts",
			inputSchema: {
				id: z.coerce.number().describe("TDD session id"),
			},
		},
		async (args) => textResult(await caller.tdd_session_get({ id: args.id })),
	);

	server.registerTool(
		"tdd_session_start",
		{
			description:
				"Open a new TDD session for a goal. Idempotent on (sessionId, runId) when runId is provided; falls back to (sessionId, goal) for legacy callers.",
			inputSchema: {
				goal: z.string().describe("The behavior or feature being implemented"),
				sessionId: z.optional(z.coerce.number()).describe("sessions.id (integer); omit to use ccSessionId"),
				ccSessionId: z.optional(z.string()).describe("Claude Code session id (alternative to sessionId)"),
				parentTddSessionId: z.optional(z.coerce.number()).describe("Parent TDD session id when decomposing"),
				startedAt: z.optional(z.string()).describe("ISO 8601 timestamp; defaults to now"),
				runId: z
					.optional(z.string())
					.describe(
						"Unique dispatch id; auto-generated (UUID slice) if omitted. Pass the value from the main agent's launch prompt.",
					),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_session_start({
					goal: args.goal,
					sessionId: args.sessionId,
					ccSessionId: args.ccSessionId,
					parentTddSessionId: args.parentTddSessionId,
					startedAt: args.startedAt,
					runId: args.runId,
				}),
			),
	);

	server.registerTool(
		"tdd_session_end",
		{
			description: "Close a TDD session with an outcome. Idempotent on (tddSessionId, outcome).",
			inputSchema: {
				tddSessionId: z.coerce.number().describe("tdd_sessions.id"),
				outcome: z.enum(["succeeded", "blocked", "abandoned"]).describe("Final outcome"),
				summaryNoteId: z.optional(z.coerce.number()).describe("Optional FK to a notes row carrying the full summary"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_session_end({
					tddSessionId: args.tddSessionId,
					outcome: args.outcome,
					summaryNoteId: args.summaryNoteId,
				}),
			),
	);

	server.registerTool(
		"tdd_session_resume",
		{
			description: "Markdown digest of a TDD session for resuming work — goal, current phase, artifact count.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_sessions.id"),
			},
		},
		async (args) => textResult(await caller.tdd_session_resume({ id: args.id })),
	);

	server.registerTool(
		"tdd_phase_transition_request",
		{
			description:
				"Request a TDD phase transition. Validates goal status, behavior↔goal membership, and D2 artifact-evidence binding rules; returns accept/deny. On accept, auto-promotes a behavior 'pending' → 'in_progress' when behaviorId is supplied (callers do not need a separate tdd_behavior_update for the start-of-cycle transition).",
			inputSchema: {
				tddSessionId: z.coerce.number().describe("tdd_sessions.id"),
				goalId: z.coerce.number().describe("tdd_session_goals.id (required; goal must be in_progress)"),
				requestedPhase: z
					.enum([
						"spike",
						"red",
						"red.triangulate",
						"green",
						"green.fake-it",
						"refactor",
						"extended-red",
						"green-without-red",
					])
					.describe("Phase to transition to"),
				citedArtifactId: z.coerce.number().describe("tdd_artifacts.id supplying the evidence"),
				behaviorId: z
					.optional(z.coerce.number())
					.describe("tdd_session_behaviors.id when transitioning a specific behavior (must belong to goalId)"),
				reason: z.optional(z.string()).describe("Free-text reason for the transition"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_phase_transition_request({
					tddSessionId: args.tddSessionId,
					goalId: args.goalId,
					requestedPhase: args.requestedPhase,
					citedArtifactId: args.citedArtifactId,
					behaviorId: args.behaviorId,
					reason: args.reason,
				}),
			),
	);

	server.registerTool(
		"tdd_goal_create",
		{
			description: "Create a goal under a TDD session. Idempotent on (sessionId, goal).",
			inputSchema: {
				sessionId: z.coerce.number().describe("tdd_sessions.id"),
				goal: z.string().describe("Coherent slice of the objective testable as a unit"),
			},
		},
		async (args) => jsonResult(await caller.tdd_goal_create({ sessionId: args.sessionId, goal: args.goal })),
	);

	server.registerTool(
		"tdd_goal_get",
		{
			description: "Read one goal with its nested behaviors.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_goals.id"),
			},
		},
		async (args) => jsonResult(await caller.tdd_goal_get({ id: args.id })),
	);

	server.registerTool(
		"tdd_goal_update",
		{
			description: "Update a goal's text and/or status. Lifecycle: pending → in_progress → done | abandoned.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_goals.id"),
				goal: z.optional(z.string()).describe("New goal text"),
				status: z
					.optional(z.enum(["pending", "in_progress", "done", "abandoned"]))
					.describe("Lifecycle status (use 'abandoned' to drop work; do not delete unless created by mistake)"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_goal_update({
					id: args.id,
					goal: args.goal,
					status: args.status,
				}),
			),
	);

	server.registerTool(
		"tdd_goal_delete",
		{
			description:
				"Hard-delete a goal (cascades to behaviors). Reserved for cleanup of mistakes; prefer status:'abandoned'.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_goals.id"),
			},
		},
		async (args) => jsonResult(await caller.tdd_goal_delete({ id: args.id })),
	);

	server.registerTool(
		"tdd_goal_list",
		{
			description: "List goals for a TDD session with nested behaviors, ordered by ordinal.",
			inputSchema: {
				sessionId: z.coerce.number().describe("tdd_sessions.id"),
			},
		},
		async (args) => jsonResult(await caller.tdd_goal_list({ sessionId: args.sessionId })),
	);

	server.registerTool(
		"tdd_behavior_create",
		{
			description:
				"Create a behavior under a goal. Idempotent on (goalId, behavior). Optionally writes dependsOnBehaviorIds in the same transaction.",
			inputSchema: {
				goalId: z.coerce.number().describe("tdd_session_goals.id"),
				behavior: z.string().describe("Atomic behavior (one red-green-refactor cycle)"),
				suggestedTestName: z.optional(z.string()).describe("Optional suggested test name"),
				dependsOnBehaviorIds: z
					.optional(z.array(z.coerce.number()))
					.describe("Optional list of behavior ids in the same goal that this behavior depends on"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_behavior_create({
					goalId: args.goalId,
					behavior: args.behavior,
					suggestedTestName: args.suggestedTestName,
					dependsOnBehaviorIds: args.dependsOnBehaviorIds,
				}),
			),
	);

	server.registerTool(
		"tdd_behavior_get",
		{
			description: "Read one behavior with its parent goal summary and dependency list.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_behaviors.id"),
			},
		},
		async (args) => jsonResult(await caller.tdd_behavior_get({ id: args.id })),
	);

	server.registerTool(
		"tdd_behavior_update",
		{
			description:
				"Update a behavior's text, suggestedTestName, status, and/or dependencies. Updating dependsOnBehaviorIds replaces the junction-table set in one transaction. Note: tdd_phase_transition_request auto-promotes a behavior pending → in_progress on accept; the orchestrator only needs to call this for the final → done transition.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_behaviors.id"),
				behavior: z.optional(z.string()).describe("New behavior text"),
				suggestedTestName: z.optional(z.string().nullable()).describe("New suggested test name (null clears it)"),
				status: z.optional(z.enum(["pending", "in_progress", "done", "abandoned"])).describe("Lifecycle status"),
				dependsOnBehaviorIds: z
					.optional(z.array(z.coerce.number()))
					.describe("Replacement dependency set (empty array clears all dependencies)"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.tdd_behavior_update({
					id: args.id,
					behavior: args.behavior,
					suggestedTestName: args.suggestedTestName,
					status: args.status,
					dependsOnBehaviorIds: args.dependsOnBehaviorIds,
				}),
			),
	);

	server.registerTool(
		"tdd_behavior_delete",
		{
			description: "Hard-delete a behavior. Reserved for cleanup of mistakes; prefer status:'abandoned'.",
			inputSchema: {
				id: z.coerce.number().describe("tdd_session_behaviors.id"),
			},
		},
		async (args) => jsonResult(await caller.tdd_behavior_delete({ id: args.id })),
	);

	server.registerTool(
		"tdd_behavior_list",
		{
			description:
				"List behaviors. Use scope='goal' with goalId to list one goal's behaviors; scope='session' with sessionId to list every behavior across all goals.",
			inputSchema: {
				scope: z.enum(["goal", "session"]).describe("Scope discriminator"),
				goalId: z.optional(z.coerce.number()).describe("tdd_session_goals.id (when scope='goal')"),
				sessionId: z.optional(z.coerce.number()).describe("tdd_sessions.id (when scope='session')"),
			},
		},
		async (args) => {
			if (args.scope === "goal") {
				if (args.goalId === undefined) {
					return jsonResult({
						ok: false,
						error: {
							_tag: "ValidationError",
							reason: "scope='goal' requires goalId",
						},
					});
				}
				return jsonResult(await caller.tdd_behavior_list({ scope: "goal", goalId: args.goalId }));
			}
			if (args.sessionId === undefined) {
				return jsonResult({
					ok: false,
					error: {
						_tag: "ValidationError",
						reason: "scope='session' requires sessionId",
					},
				});
			}
			return jsonResult(await caller.tdd_behavior_list({ scope: "session", sessionId: args.sessionId }));
		},
	);

	server.registerTool(
		"hypothesis_list",
		{
			description: "List agent hypotheses with optional filtering by session or validation outcome",
			inputSchema: {
				sessionId: z.optional(z.coerce.number()).describe("Filter to a specific session id"),
				outcome: z
					.optional(z.enum(["confirmed", "refuted", "abandoned", "open"]))
					.describe("Filter by validation outcome (open = not yet validated)"),
				limit: z.optional(z.coerce.number()).describe("Max hypotheses to return (default 50)"),
			},
		},
		async (args) =>
			textResult(
				await caller.hypothesis_list({
					sessionId: args.sessionId,
					outcome: args.outcome,
					limit: args.limit,
				}),
			),
	);

	// ── Hypothesis writes ───────────────────────────────────────────────

	server.registerTool(
		"hypothesis_record",
		{
			description: "Record an agent hypothesis about a test failure or code behavior",
			inputSchema: {
				sessionId: z.coerce.number().describe("Session id the hypothesis belongs to"),
				content: z.string().describe("Hypothesis content"),
				createdTurnId: z.optional(z.coerce.number()).describe("Turn id when the hypothesis was created"),
				citedTestErrorId: z.optional(z.coerce.number()).describe("Test error id cited as evidence"),
				citedStackFrameId: z.optional(z.coerce.number()).describe("Stack frame id cited as evidence"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.hypothesis_record({
					sessionId: args.sessionId,
					content: args.content,
					createdTurnId: args.createdTurnId,
					citedTestErrorId: args.citedTestErrorId,
					citedStackFrameId: args.citedStackFrameId,
				}),
			),
	);

	server.registerTool(
		"hypothesis_validate",
		{
			description: "Record a validation outcome (confirmed / refuted / abandoned) for an existing hypothesis",
			inputSchema: {
				id: z.coerce.number().describe("Hypothesis id to validate"),
				outcome: z.enum(["confirmed", "refuted", "abandoned"]).describe("Validation outcome"),
				validatedTurnId: z.optional(z.coerce.number()).describe("Turn id when the validation was recorded"),
				validatedAt: z.string().describe("ISO 8601 timestamp of validation"),
			},
		},
		async (args) =>
			jsonResult(
				await caller.hypothesis_validate({
					id: args.id,
					outcome: args.outcome,
					validatedTurnId: args.validatedTurnId,
					validatedAt: args.validatedAt,
				}),
			),
	);

	// ── TDD progress push ──────────────────────────────────────────────

	server.registerTool(
		"tdd_progress_push",
		{
			description:
				"Push a TDD progress event to the main agent via Claude Code channels. The MCP server validates the payload against the ChannelEvent union and resolves goalId/sessionId server-side from behaviorId for behavior-scoped events (so a stale orchestrator context cannot push the wrong tree coordinates). Best-effort — returns { ok: true } regardless of whether channels are active.",
			inputSchema: {
				payload: z
					.string()
					.describe("Pre-stringified ChannelEvent JSON (see schemas/ChannelEvent in vitest-agent-sdk)"),
			},
		},
		async (args) => {
			let resolvedPayload = args.payload;
			try {
				const raw = JSON.parse(args.payload);
				const enriched = await resolveChannelEvent(ctx, raw);
				resolvedPayload = JSON.stringify(enriched);
			} catch {
				// Malformed JSON or DB read failure — fall through with the
				// original payload. Channel push is best-effort.
			}
			try {
				await server.server.notification({
					method: "notifications/claude/channel",
					params: { content: resolvedPayload },
				});
			} catch {
				// Channels not active — swallow silently
			}
			return jsonResult({ ok: true });
		},
	);

	// ── Acceptance metrics ──────────────────────────────────────────────

	server.registerTool(
		"acceptance_metrics",
		{
			description: "Compute the four spec Annex A acceptance metrics from the current database",
			inputSchema: {},
		},
		async () => textResult(await caller.acceptance_metrics({})),
	);

	// ── Triage brief ────────────────────────────────────────────────────

	server.registerTool(
		"triage_brief",
		{
			description: "Orientation triage brief: failing tests, flaky tests, open TDD sessions, suggested next actions",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project (or project:subProject)"),
				maxLines: z.optional(z.coerce.number()).describe("Soft cap on rendered output lines"),
			},
		},
		async (args) =>
			textResult(
				await caller.triage_brief({
					project: args.project,
					maxLines: args.maxLines,
				}),
			),
	);

	// ── Wrapup prompt ───────────────────────────────────────────────────

	server.registerTool(
		"wrapup_prompt",
		{
			description:
				"Tailored wrap-up prompt for a session (Stop / SessionEnd / PreCompact / TDD handoff / UserPromptSubmit nudge variants)",
			inputSchema: {
				sessionId: z.optional(z.coerce.number()).describe("sessions.id (integer); omit to use ccSessionId"),
				ccSessionId: z.optional(z.string()).describe("Claude Code session id (alternative to sessionId)"),
				kind: z
					.optional(z.enum(["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]))
					.describe("Wrap-up flavor (default: session_end)"),
				userPromptHint: z.optional(z.string()).describe("For user_prompt_nudge: the prompt text to inspect"),
			},
		},
		async (args) =>
			textResult(
				await caller.wrapup_prompt({
					sessionId: args.sessionId,
					ccSessionId: args.ccSessionId,
					kind: args.kind,
					userPromptHint: args.userPromptHint,
				}),
			),
	);

	server.registerTool(
		"commit_changes",
		{
			description:
				"Commit metadata + changed files captured by the post-commit hook. Returns up to 20 most-recent when sha is omitted.",
			inputSchema: {
				sha: z.optional(z.string()).describe("Specific commit sha to fetch; omit for recent commits"),
			},
		},
		async (args) => textResult(await caller.commit_changes({ sha: args.sha })),
	);

	// ── Session-id association (ergonomic default for session-aware tools) ───

	// Shared elicitation helper. Fires once per process — if the id is
	// already set it returns immediately. The Elicitation hook
	// (plugin/hooks/elicitation-session-id.sh) auto-accepts with the
	// Claude Code session id so no dialog is shown to the user.
	const elicitSessionId = async (): Promise<void> => {
		if (ctx.currentSessionId.get() !== null) return;
		try {
			const result = await server.server.elicitInput({
				message: "Establishing Claude Code session association for vitest-agent",
				requestedSchema: {
					type: "object" as const,
					properties: {
						sessionId: {
							type: "string" as const,
							title: "Claude Code Session ID",
							description: "The cc_session_id for this Claude Code window",
						},
					},
					required: ["sessionId"],
				},
			});
			if (result.action === "accept" && typeof result.content?.sessionId === "string") {
				ctx.currentSessionId.set(result.content.sessionId);
			}
		} catch {
			// Client does not support elicitation; id can be set via set_current_session_id
		}
	};

	server.registerTool(
		"get_current_session_id",
		{
			description:
				"Get the Claude Code cc_session_id this MCP server is currently associated with. Automatically seeds the id via elicitation on first call when not yet set. Returns { currentSessionId: string | null }.",
			inputSchema: {},
		},
		async () => {
			await elicitSessionId();
			return jsonResult(await caller.get_current_session_id({}));
		},
	);

	server.registerTool(
		"set_current_session_id",
		{
			description:
				"Associate this MCP server process with a Claude Code cc_session_id. Once set, session-aware tools default to this id when ccSessionId is omitted. Pass null to clear. Each Claude Code window has its own MCP server, so this association is per-window.",
			inputSchema: {
				id: z.union([z.string(), z.null()]).describe("Claude Code session id, or null to clear"),
			},
		},
		async (args) => jsonResult(await caller.set_current_session_id({ id: args.id })),
	);

	server.registerTool(
		"ping",
		{
			description: "Ping the MCP server — returns 'pong'. Used to verify hot-patch reload.",
		},
		async () => textResult(await caller.ping()),
	);

	// Best-effort early seeding: fires after the MCP handshake completes.
	// The hook system may not be ready this early; get_current_session_id
	// serves as the reliable fallback if this no-ops.
	server.server.oninitialized = () => {
		void elicitSessionId();
	};

	registerAllResources(server);
	registerAllPrompts(server);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}
