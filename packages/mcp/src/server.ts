import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChannelEvent, DataReader } from "@vitest-agent/sdk";
import { Effect, Option, Schema } from "effect";
import { z } from "zod";
import type { McpContext } from "./context.js";
import { createCallerFactory } from "./context.js";
import { registerAllPrompts } from "./prompts/index.js";
import { appRouter } from "./router.js";
import { AcceptanceMetricsAsMarkdown, AcceptanceMetricsResult } from "./tools/acceptance-metrics.js";
import { CacheHealthAsMarkdown, CacheHealthResult } from "./tools/cache-health.js";
import { CommitChangesAsMarkdown, CommitChangesResult } from "./tools/commit-changes.js";
import { ConfigureAsMarkdown, ConfigureResult } from "./tools/configure.js";
import { TestCoverageAsMarkdown, TestCoverageResult } from "./tools/coverage.js";
import { TestErrorsAsMarkdown, TestErrorsResult } from "./tools/errors.js";
import { FailureSignatureGetAsMarkdown, FailureSignatureGetResult } from "./tools/failure-signature-get.js";
import { FileCoverageAsMarkdown, FileCoverageResult } from "./tools/file-coverage.js";
import { HelpResult } from "./tools/help.js";
import { TestHistoryAsMarkdown, TestHistoryResult } from "./tools/history.js";
import { HypothesisResult, formatHypothesisListMarkdown } from "./tools/hypothesis.js";
import { InventoryAsMarkdown, InventoryResult } from "./tools/inventory.js";
import { NoteResult, formatNoteListMarkdown } from "./tools/note.js";
import { TestOverviewAsMarkdown, TestOverviewResult } from "./tools/overview.js";
import { PingResult } from "./tools/ping.js";
import { RegisterAgentResult } from "./tools/register-agent.js";
import { RunTestsAsMarkdown, RunTestsResult } from "./tools/run-tests.js";
import { SettingsListAsMarkdown, SettingsListResult } from "./tools/settings-list.js";
import { TestStatusAsMarkdown, TestStatusResult } from "./tools/status.js";
import { TddArtifactListAsMarkdown, TddArtifactListResult } from "./tools/tdd-artifact.js";
import { TddBehaviorResult } from "./tools/tdd-behavior.js";
import { TddGoalResult } from "./tools/tdd-goal.js";
import { PhaseTransitionResult } from "./tools/tdd-phase-transition-request.js";
import { TddTaskAsMarkdown, TddTaskResult } from "./tools/tdd-task.js";
import { TestAsMarkdown, TestResult } from "./tools/test.js";
import { TestTrendsAsMarkdown, TestTrendsResult } from "./tools/trends.js";
import { TriageBriefResult } from "./tools/triage-brief.js";
import { TurnSearchAsMarkdown, TurnSearchResult } from "./tools/turn-search.js";
import { WrapupPromptResult } from "./tools/wrapup-prompt.js";
import { effectToZodSchema } from "./utils/effect-to-zod.js";

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

/**
 * Emit both a human-readable text block (`content[]`) and a typed
 * structured payload (`structuredContent`) per the MCP 2025-06-18
 * tool-result contract.
 *
 * Per the spec, "for backwards compatibility, a tool that returns
 * structured content SHOULD also return the serialized JSON in a
 * TextContent block." The helper keeps the existing markdown/JSON
 * text exactly as today (so the human-facing transcript is unchanged)
 * and adds `structuredContent` on top so the LLM can parse the
 * tool's data without inferring it from the rendered text.
 *
 * `structuredContent` MUST be a JSON object — not an array, not a
 * primitive. Tools that conceptually return a list wrap it as
 * `{ items: [...] }` (or a more specific key like `artifacts: [...]`).
 *
 * @internal
 */
function structuredResult<T extends object>(
	text: string,
	structured: T,
): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
	return {
		content: [{ type: "text" as const, text }],
		structuredContent: structured as unknown as Record<string, unknown>,
	};
}

/**
 * Shorthand for mutation/CRUD tools whose text channel is just the
 * JSON-stringified form of the same object that travels in
 * `structuredContent`. Replaces the legacy `jsonResult` helper for
 * tools that previously rendered their result as JSON.stringify; the
 * structured payload is identical, so the agent gets the typed object
 * via MCP's structuredContent channel without paying the markdown
 * formatter ceremony of `Schema.transformOrFail`.
 *
 * @internal
 */
function structuredJsonResult<T extends object>(value: T) {
	return structuredResult(JSON.stringify(value, null, 2), value);
}

/**
 * Starts the MCP server over stdio, registering all tools and prompts.
 *
 * Constructs the MCP server instance, registers all tRPC-backed tools (wired through
 * `ctx.runtime`), calls `registerAllPrompts`, then connects
 * a `StdioServerTransport`. Returns when the transport disconnects.
 *
 * @param ctx - the MCP context carrying the shared ManagedRuntime and session refs
 * @public
 */
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
			description:
				"Use when you need the catalog of available MCP tools and their parameters. Markdown in content[]; same string available as structuredContent.helpText.",
			outputSchema: effectToZodSchema(HelpResult) as never,
		},
		async () => {
			const data = await caller.help();
			return structuredResult(data.helpText, data);
		},
	);

	// ── Read-only tools (queries returning markdown) ────────────────────

	server.registerTool(
		"test_status",
		{
			description:
				"Use when you need each project's current pass/fail state from the most recent run. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, manifestUpdatedAt, projectFilter?, entries[] } or absent variant).",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
			outputSchema: effectToZodSchema(TestStatusResult) as never,
		},
		async (args) => {
			const data = await caller.test_status({ project: args.project });
			const text = Schema.decodeSync(TestStatusAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"test_overview",
		{
			description:
				"Use when you want a summary of the test landscape with per-project run metrics. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, projectFilter?, runs[] } or absent variant).",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
			},
			outputSchema: effectToZodSchema(TestOverviewResult) as never,
		},
		async (args) => {
			const data = await caller.test_overview({ project: args.project });
			const text = Schema.decodeSync(TestOverviewAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"test_coverage",
		{
			description:
				"Use when coverage drops and you need per-metric gap analysis against thresholds and targets. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, project, coverage } or absent variant).",
			inputSchema: {
				project: z.optional(z.string()).describe("Project name"),
			},
			outputSchema: effectToZodSchema(TestCoverageResult) as never,
		},
		async (args) => {
			const data = await caller.test_coverage({ project: args.project });
			const text = Schema.decodeSync(TestCoverageAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"test_history",
		{
			description:
				"Use when failures recur and you need flaky, persistent, and recovered test classifications. Returns markdown in content[] and a typed JSON object in structuredContent (project, hasData, history, flaky[], persistent[], recovered[]).",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
			},
			outputSchema: effectToZodSchema(TestHistoryResult) as never,
		},
		async (args) => {
			const data = await caller.test_history({ project: args.project });
			const text = Schema.decodeSync(TestHistoryAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"test_trends",
		{
			description:
				"Use when you want to see whether a project's coverage is trending up or down over time. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, project, trends? }).",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
				limit: z.optional(z.coerce.number()).describe("Max number of trend entries to return"),
			},
			outputSchema: effectToZodSchema(TestTrendsResult) as never,
		},
		async (args) => {
			const data = await caller.test_trends({ project: args.project, limit: args.limit });
			const text = Schema.decodeSync(TestTrendsAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"test_errors",
		{
			description:
				"Use when a test fails and you need error detail, diffs, and the cite-able test_errors.id / stack_frames.id values needed by hypothesis (action: record). Returns both a markdown rendering (in content[].text) and a typed JSON object (in structuredContent) — agents should prefer structuredContent.errors[].",
			inputSchema: {
				project: z.string().describe("Project name (required)"),
				errorName: z.optional(z.string()).describe("Filter to a specific error name"),
			},
			outputSchema: effectToZodSchema(TestErrorsResult) as never,
		},
		async (args) => {
			const data = await caller.test_errors({
				project: args.project,
				...(args.errorName !== undefined && { errorName: args.errorName }),
			});
			// Schema.decodeSync goes Encoded → Type; on TestErrorsAsMarkdown
			// that direction is structured → markdown (the rendering side).
			const text = Schema.decodeSync(TestErrorsAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Consolidated `test` tool (list / get / for_file) ───────────────

	server.registerTool(
		"test",
		{
			description:
				"Use to inspect tests, with an action discriminator: action='list' (project?, state?, module?, limit?) returns matching tests; action='get' (fullName, project?) returns details + errors + run history; action='for_file' (filePath) returns test modules covering a source file. structuredContent carries the typed payload (discriminate on `action`, then on `found` for get).",
			inputSchema: {
				action: z.enum(["list", "get", "for_file"]).describe("Inspection discriminator"),
				project: z.optional(z.string()),
				state: z.optional(z.string()).describe("list: filter by state"),
				module: z.optional(z.string()).describe("list: filter by module path"),
				limit: z.optional(z.coerce.number()).describe("list: max rows to return"),
				fullName: z.optional(z.string()).describe("get: full test name"),
				filePath: z.optional(z.string()).describe("for_file: source file path"),
			},
			outputSchema: effectToZodSchema(TestResult) as never,
		},
		async (args) => {
			let data: Awaited<ReturnType<typeof caller.test>>;
			if (args.action === "list") {
				data = await caller.test({
					action: "list",
					...(args.project !== undefined && { project: args.project }),
					...(args.state !== undefined && { state: args.state }),
					...(args.module !== undefined && { module: args.module }),
					...(args.limit !== undefined && { limit: args.limit }),
				});
			} else if (args.action === "get") {
				data = await caller.test({
					action: "get",
					fullName: args.fullName as string,
					...(args.project !== undefined && { project: args.project }),
				});
			} else {
				data = await caller.test({ action: "for_file", filePath: args.filePath as string });
			}
			const text = Schema.decodeSync(TestAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"file_coverage",
		{
			description:
				"Use when you need coverage for one source file: per-metric values, uncovered lines, and related tests. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, matched?, filePath, report?, totals?, relatedTestFiles[] }).",
			inputSchema: {
				filePath: z.string().describe("Source file path to check coverage for"),
				project: z.optional(z.string()).describe("Project name"),
			},
			outputSchema: effectToZodSchema(FileCoverageResult) as never,
		},
		async (args) => {
			const data = await caller.file_coverage({ filePath: args.filePath, project: args.project });
			const text = Schema.decodeSync(FileCoverageAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"configure",
		{
			description:
				"Use when you need the captured Vitest settings for a test run. Returns markdown in content[] and a typed JSON object in structuredContent ({ found, source, settings?, requestedHash? }).",
			inputSchema: {
				settingsHash: z.optional(z.string()).describe("Settings hash from a manifest entry or test run"),
			},
			outputSchema: effectToZodSchema(ConfigureResult) as never,
		},
		async (args) => {
			const data = await caller.configure({ settingsHash: args.settingsHash });
			const text = Schema.decodeSync(ConfigureAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"cache_health",
		{
			description:
				"Use when you suspect stale data and need manifest presence, project states, and staleness. Returns markdown in content[] and a typed JSON object in structuredContent ({ manifestPresent, manifest?, ageMs?, stale? }).",
			outputSchema: effectToZodSchema(CacheHealthResult) as never,
		},
		async () => {
			const data = await caller.cache_health();
			const text = Schema.decodeSync(CacheHealthAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Consolidated `inventory` tool (project / module / suite / session) ───

	server.registerTool(
		"inventory",
		{
			description:
				"Use to discover what exists in the workspace, with a kind discriminator: project / module / suite / session. structuredContent discriminates on `inventoryKind` (project, module, suite, session_detail, session_list) so callers can branch on the response shape without parsing markdown.",
			inputSchema: {
				kind: z.enum(["project", "module", "suite", "session"]).describe("Inventory entity"),
				id: z.optional(z.coerce.number()).describe("session: single-row lookup by id"),
				project: z.optional(z.string()),
				module: z.optional(z.string()).describe("suite: filter by module path"),
				agentKind: z.optional(z.enum(["main", "subagent"])).describe("session: filter by agent kind"),
				limit: z.optional(z.coerce.number()).describe("session: max rows"),
			},
			outputSchema: effectToZodSchema(InventoryResult) as never,
		},
		async (args) => {
			let data: Awaited<ReturnType<typeof caller.inventory>>;
			if (args.kind === "project") {
				data = await caller.inventory({ kind: "project" });
			} else if (args.kind === "module") {
				data = await caller.inventory({
					kind: "module",
					...(args.project !== undefined && { project: args.project }),
				});
			} else if (args.kind === "suite") {
				data = await caller.inventory({
					kind: "suite",
					...(args.project !== undefined && { project: args.project }),
					...(args.module !== undefined && { module: args.module }),
				});
			} else {
				data = await caller.inventory({
					kind: "session",
					...(args.id !== undefined && { id: args.id }),
					...(args.project !== undefined && { project: args.project }),
					...(args.agentKind !== undefined && { agentKind: args.agentKind }),
					...(args.limit !== undefined && { limit: args.limit }),
				});
			}
			const text = Schema.decodeSync(InventoryAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"settings_list",
		{
			description:
				"Use when you need every captured settings snapshot and its hash. Returns markdown in content[] and a typed JSON object in structuredContent ({ count, settings[] }).",
			outputSchema: effectToZodSchema(SettingsListResult) as never,
		},
		async () => {
			const data = await caller.settings_list({});
			const text = Schema.decodeSync(SettingsListAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Mutation tools (return JSON) ────────────────────────────────────

	server.registerTool(
		"register_agent",
		{
			description:
				"Use when an LLM-agent invocation starts and must be recorded in the per-project store. Idempotent on (chatId, agentType, parentAgentId, clientNonce). Returns ok:true with agentId on insert, or ok:false with error.code='AGENT_ALREADY_REGISTERED'/'PARENT_AGENT_NOT_FOUND'/'SESSION_NOT_FOUND'/'INVALID_AGENT_TYPE_PREFIX' on the four documented failure modes. agentType must begin with the host-kind prefix (e.g., 'claude-code-main').",
			inputSchema: {
				chatId: z.string().describe("Host's chat UUID (session_id from CC hook payload, etc.)"),
				conversationId: z
					.optional(z.string())
					.describe("Canonical conversation UUID (from session-map mapConversation)"),
				hostKind: z.optional(z.string()).describe("Host vendor identifier; defaults to 'claude-code'"),
				agentType: z.string().describe("Agent type; must begin with the host-kind prefix"),
				parentAgentId: z.optional(z.string()).describe("Parent agent UUID for subagent registrations"),
				clientNonce: z
					.optional(z.string())
					.describe(
						"Disambiguator for sibling-subagent registrations under the same parent; the server derives a deterministic default when omitted, which collapses parallel siblings into one row",
					),
				startGitBranch: z.optional(z.string()),
				startGitCommitSha: z.optional(z.string()),
				startWorktreeDir: z.optional(z.string()),
			},
			outputSchema: effectToZodSchema(RegisterAgentResult) as never,
		},
		async (args) => {
			const result = await caller.register_agent({
				chatId: args.chatId,
				agentType: args.agentType,
				...(args.conversationId !== undefined && { conversationId: args.conversationId }),
				...(args.hostKind !== undefined && { hostKind: args.hostKind }),
				...(args.parentAgentId !== undefined && { parentAgentId: args.parentAgentId }),
				...(args.clientNonce !== undefined && { clientNonce: args.clientNonce }),
				...(args.startGitBranch !== undefined && { startGitBranch: args.startGitBranch }),
				...(args.startGitCommitSha !== undefined && { startGitCommitSha: args.startGitCommitSha }),
				...(args.startWorktreeDir !== undefined && { startWorktreeDir: args.startWorktreeDir }),
			});
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result) }],
				isError: result.ok === false,
				structuredContent: result as unknown as Record<string, unknown>,
			};
		},
	);

	server.registerTool(
		"run_tests",
		{
			description:
				"Use to run Vitest tests, with optional file and project filters. structuredContent carries the typed AgentReport plus per-test classifications (discriminate on `kind`: ok, timeout, error). The legacy format=json arg is dropped — structuredContent supersedes it.",
			inputSchema: {
				files: z.optional(z.array(z.string())).describe("Test file paths to run"),
				project: z.optional(z.string()).describe("Project name to filter"),
				timeout: z.optional(z.coerce.number()).describe("Timeout in seconds (default: 120)"),
				// Injected by the `pre-tool-use-mcp-run-tests.sh` hook.
				// Agents do not pass this directly; if absent, the tool
				// falls back to its boot-time SessionContext.
				_sessionContext: z
					.optional(
						z.object({
							chatId: z.string(),
							conversationId: z.string(),
							mainAgentId: z.string(),
						}),
					)
					.describe("Hook-injected session attribution UUIDs; do not pass manually."),
			},
			outputSchema: effectToZodSchema(RunTestsResult) as never,
		},
		async (args) => {
			const data = await caller.run_tests({
				files: args.files,
				project: args.project,
				timeout: args.timeout,
				...(args._sessionContext !== undefined && { _sessionContext: args._sessionContext }),
			});
			const text = Schema.decodeSync(RunTestsAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Note CRUD tools ─────────────────────────────────────────────────

	// ── Consolidated `note` tool (create / list / get / update / delete / search) ───

	server.registerTool(
		"note",
		{
			description:
				"Use to manage notes, with a CRUD action discriminator: action='create' writes a scoped note; action='list' (scope?, project?, testFullName?) returns matching notes; action='get' (id) returns a structured note; action='update' (id, ...patch) edits; action='delete' (id) removes; action='search' (query) does FTS5 across title and content. structuredContent always carries the typed result (discriminate on `action`); list/search additionally render markdown in the text channel.",
			inputSchema: {
				action: z.enum(["create", "list", "get", "update", "delete", "search"]).describe("CRUD discriminator"),
				// Shared
				id: z.optional(z.coerce.number()).describe("get/update/delete: note id"),
				project: z.optional(z.string()),
				// create
				title: z.optional(z.string()),
				content: z.optional(z.string()),
				scope: z
					.optional(z.enum(["global", "project", "module", "suite", "test", "note"]))
					.describe("create: required scope; list: optional filter"),
				testFullName: z.optional(z.string()),
				modulePath: z.optional(z.string()),
				parentNoteId: z.optional(z.coerce.number()),
				createdBy: z.optional(z.string()),
				expiresAt: z.optional(z.string()),
				pinned: z.optional(z.boolean()),
				// search
				query: z.optional(z.string()).describe("search: FTS5 query"),
			},
			outputSchema: effectToZodSchema(NoteResult) as never,
		},
		async (args) => {
			if (args.action === "create") {
				return structuredJsonResult(
					await caller.note({
						action: "create",
						title: args.title as string,
						content: args.content as string,
						scope: args.scope as "global" | "project" | "module" | "suite" | "test" | "note",
						...(args.project !== undefined && { project: args.project }),
						...(args.testFullName !== undefined && { testFullName: args.testFullName }),
						...(args.modulePath !== undefined && { modulePath: args.modulePath }),
						...(args.parentNoteId !== undefined && { parentNoteId: args.parentNoteId }),
						...(args.createdBy !== undefined && { createdBy: args.createdBy }),
						...(args.expiresAt !== undefined && { expiresAt: args.expiresAt }),
						...(args.pinned !== undefined && { pinned: args.pinned }),
					}),
				);
			}
			if (args.action === "list") {
				const data = await caller.note({
					action: "list",
					...(args.scope !== undefined && { scope: args.scope }),
					...(args.project !== undefined && { project: args.project }),
					...(args.testFullName !== undefined && { testFullName: args.testFullName }),
				});
				return structuredResult(formatNoteListMarkdown(data), data);
			}
			if (args.action === "get") {
				return structuredJsonResult(await caller.note({ action: "get", id: args.id as number }));
			}
			if (args.action === "update") {
				return structuredJsonResult(
					await caller.note({
						action: "update",
						id: args.id as number,
						...(args.title !== undefined && { title: args.title }),
						...(args.content !== undefined && { content: args.content }),
						...(args.pinned !== undefined && { pinned: args.pinned }),
						...(args.expiresAt !== undefined && { expiresAt: args.expiresAt }),
					}),
				);
			}
			if (args.action === "delete") {
				return structuredJsonResult(await caller.note({ action: "delete", id: args.id as number }));
			}
			const searchData = await caller.note({ action: "search", query: args.query as string });
			return structuredResult(formatNoteListMarkdown(searchData), searchData);
		},
	);

	// ── Turn search ─────────────────────────────────────────────────────

	server.registerTool(
		"turn_search",
		{
			description:
				"Use when you need to find past turns across sessions by type, time, or session. Returns markdown in content[] and a typed JSON object in structuredContent ({ count, turns[] }).",
			inputSchema: {
				sessionId: z.optional(z.coerce.number()).describe("Filter to a specific session id"),
				since: z.optional(z.string()).describe("ISO 8601 cutoff — return turns after this timestamp"),
				type: z
					.optional(z.enum(["user_prompt", "tool_call", "tool_result", "file_edit", "hook_fire", "note", "hypothesis"]))
					.describe("Filter by turn type"),
				limit: z.optional(z.coerce.number()).describe("Max turns to return (default 100)"),
			},
			outputSchema: effectToZodSchema(TurnSearchResult) as never,
		},
		async (args) => {
			const data = await caller.turn_search({
				sessionId: args.sessionId,
				since: args.since,
				type: args.type,
				limit: args.limit,
			});
			const text = Schema.decodeSync(TurnSearchAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Failure signatures ──────────────────────────────────────────────

	server.registerTool(
		"failure_signature_get",
		{
			description:
				"Use when you have a failure-signature hash and need its first-seen date and occurrence history. Returns markdown in content[] and a typed JSON object in structuredContent ({ found, signatureHash?, firstSeenAt?, occurrenceCount?, recentErrors?[] } or absent variant).",
			inputSchema: {
				hash: z.string().describe("16-char failure signature hash"),
			},
			outputSchema: effectToZodSchema(FailureSignatureGetResult) as never,
		},
		async (args) => {
			const data = await caller.failure_signature_get({ hash: args.hash });
			const text = Schema.decodeSync(FailureSignatureGetAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── TDD tools ───────────────────────────────────────────────────────

	// ── Consolidated `tdd_task` tool (start / end / get / resume) ──────

	server.registerTool(
		"tdd_task",
		{
			description:
				"Use to manage a TDD task lifecycle, with an action discriminator: action='start' (goal, sessionId|chatId, parentTddTaskId?, startedAt?, runId?) opens a new task; action='end' (tddTaskId, outcome, summaryNoteId?) closes one; action='get' (tddTaskId) returns markdown details; action='resume' (tddTaskId) returns a compact digest.",
			inputSchema: {
				action: z.enum(["start", "end", "get", "resume"]).describe("Lifecycle discriminator"),
				tddTaskId: z.optional(z.coerce.number()).describe("end/get/resume: tdd task id"),
				goal: z.optional(z.string()).describe("start: goal text"),
				sessionId: z.optional(z.coerce.number()).describe("start: sessions.id (alternative to chatId)"),
				chatId: z.optional(z.string()).describe("start: host chat UUID"),
				parentTddTaskId: z.optional(z.coerce.number()).describe("start: parent task id when decomposing"),
				startedAt: z.optional(z.string()),
				runId: z.optional(z.string()),
				outcome: z.optional(z.enum(["succeeded", "blocked", "abandoned"])).describe("end: final outcome"),
				summaryNoteId: z.optional(z.coerce.number()),
			},
			outputSchema: effectToZodSchema(TddTaskResult) as never,
		},
		async (args) => {
			let data: Awaited<ReturnType<typeof caller.tdd_task>>;
			if (args.action === "start") {
				data = await caller.tdd_task({
					action: "start",
					goal: args.goal as string,
					...(args.sessionId !== undefined && { sessionId: args.sessionId }),
					...(args.chatId !== undefined && { chatId: args.chatId }),
					...(args.parentTddTaskId !== undefined && { parentTddTaskId: args.parentTddTaskId }),
					...(args.startedAt !== undefined && { startedAt: args.startedAt }),
					...(args.runId !== undefined && { runId: args.runId }),
				});
			} else if (args.action === "end") {
				data = await caller.tdd_task({
					action: "end",
					tddTaskId: args.tddTaskId as number,
					outcome: args.outcome as "succeeded" | "blocked" | "abandoned",
					...(args.summaryNoteId !== undefined && { summaryNoteId: args.summaryNoteId }),
				});
			} else if (args.action === "get") {
				data = await caller.tdd_task({ action: "get", tddTaskId: args.tddTaskId as number });
			} else {
				data = await caller.tdd_task({ action: "resume", tddTaskId: args.tddTaskId as number });
			}
			const text = Schema.decodeSync(TddTaskAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	server.registerTool(
		"tdd_phase_transition_request",
		{
			description:
				"Use when advancing a TDD cycle and you need a phase transition validated and recorded. Validates goal status, behavior↔goal membership, and D2 artifact-evidence binding rules; returns accept/deny. On accept, auto-promotes a behavior 'pending' → 'in_progress' when behaviorId is supplied. citedArtifactId is OPTIONAL — when omitted, the most recent matching artifact is auto-resolved (kind comes from citedArtifactKind if supplied, otherwise from the transition's required-evidence rule). Transitions like spike→red that require no artifact need neither field. The accepted response echoes citedArtifactId + citedArtifactSource so the caller can see which row was picked.",
			inputSchema: {
				tddTaskId: z.coerce.number().describe("tdd_tasks.id"),
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
				citedArtifactId: z
					.optional(z.coerce.number())
					.describe("tdd_artifacts.id supplying the evidence. Optional — auto-resolved when omitted."),
				citedArtifactKind: z
					.optional(
						z.enum(["test_written", "test_failed_run", "code_written", "test_passed_run", "refactor", "test_weakened"]),
					)
					.describe(
						"Kind to look up when citedArtifactId is omitted (defaults to the kind required by the transition).",
					),
				behaviorId: z
					.optional(z.coerce.number())
					.describe("tdd_session_behaviors.id when transitioning a specific behavior (must belong to goalId)"),
				reason: z.optional(z.string()).describe("Free-text reason for the transition"),
			},
			outputSchema: effectToZodSchema(PhaseTransitionResult) as never,
		},
		async (args) =>
			structuredJsonResult(
				await caller.tdd_phase_transition_request({
					tddTaskId: args.tddTaskId,
					goalId: args.goalId,
					requestedPhase: args.requestedPhase,
					...(args.citedArtifactId !== undefined && { citedArtifactId: args.citedArtifactId }),
					...(args.citedArtifactKind !== undefined && { citedArtifactKind: args.citedArtifactKind }),
					...(args.behaviorId !== undefined && { behaviorId: args.behaviorId }),
					...(args.reason !== undefined && { reason: args.reason }),
				}),
			),
	);

	// ── Consolidated `tdd_goal` tool (create / update / delete / get / list) ───

	server.registerTool(
		"tdd_goal",
		{
			description:
				"Use to manage TDD goals, with a CRUD action discriminator: action='create' (tddTaskId, goal) is idempotent on (tddTaskId, goal); action='update' (id, goal?, status?) edits text and/or lifecycle status; action='delete' (id) hard-deletes (prefer status:'abandoned'); action='get' (id) reads with nested behaviors; action='list' (tddTaskId) returns all goals for a TDD task.",
			inputSchema: {
				action: z.enum(["create", "update", "delete", "get", "list"]).describe("CRUD discriminator"),
				id: z.optional(z.coerce.number()).describe("update/delete/get: goal id"),
				tddTaskId: z.optional(z.coerce.number()).describe("create/list: tdd task id"),
				goal: z.optional(z.string()),
				status: z.optional(z.enum(["pending", "in_progress", "done", "abandoned"])),
			},
			outputSchema: effectToZodSchema(TddGoalResult) as never,
		},
		async (args) => {
			if (args.action === "create") {
				return structuredJsonResult(
					await caller.tdd_goal({
						action: "create",
						tddTaskId: args.tddTaskId as number,
						goal: args.goal as string,
					}),
				);
			}
			if (args.action === "update") {
				return structuredJsonResult(
					await caller.tdd_goal({
						action: "update",
						id: args.id as number,
						...(args.goal !== undefined && { goal: args.goal }),
						...(args.status !== undefined && { status: args.status }),
					}),
				);
			}
			if (args.action === "delete") {
				return structuredJsonResult(await caller.tdd_goal({ action: "delete", id: args.id as number }));
			}
			if (args.action === "get") {
				return structuredJsonResult(await caller.tdd_goal({ action: "get", id: args.id as number }));
			}
			return structuredJsonResult(await caller.tdd_goal({ action: "list", tddTaskId: args.tddTaskId as number }));
		},
	);

	// ── Consolidated `tdd_behavior` tool (create / update / delete / get / list_by_goal / list_by_tdd_task) ───

	server.registerTool(
		"tdd_behavior",
		{
			description:
				"Use to manage TDD behaviors, with a CRUD action discriminator: action='create' (goalId, behavior, suggestedTestName?, dependsOnBehaviorIds?) is idempotent on (goalId, behavior); action='update' (id, ...patch) edits; action='delete' (id) hard-deletes; action='get' (id) reads; action='list_by_goal' (goalId) lists one goal's behaviors; action='list_by_tdd_task' (tddTaskId) lists across all goals.",
			inputSchema: {
				action: z
					.enum(["create", "update", "delete", "get", "list_by_goal", "list_by_tdd_task"])
					.describe("CRUD discriminator"),
				id: z.optional(z.coerce.number()),
				goalId: z.optional(z.coerce.number()),
				tddTaskId: z.optional(z.coerce.number()),
				behavior: z.optional(z.string()),
				suggestedTestName: z.optional(z.string().nullable()),
				status: z.optional(z.enum(["pending", "in_progress", "done", "abandoned"])),
				dependsOnBehaviorIds: z.optional(z.array(z.coerce.number())),
			},
			outputSchema: effectToZodSchema(TddBehaviorResult) as never,
		},
		async (args) => {
			if (args.action === "create") {
				return structuredJsonResult(
					await caller.tdd_behavior({
						action: "create",
						goalId: args.goalId as number,
						behavior: args.behavior as string,
						...(args.suggestedTestName !== undefined &&
							args.suggestedTestName !== null && {
								suggestedTestName: args.suggestedTestName,
							}),
						...(args.dependsOnBehaviorIds !== undefined && {
							dependsOnBehaviorIds: args.dependsOnBehaviorIds,
						}),
					}),
				);
			}
			if (args.action === "update") {
				return structuredJsonResult(
					await caller.tdd_behavior({
						action: "update",
						id: args.id as number,
						...(args.behavior !== undefined && { behavior: args.behavior }),
						...(args.suggestedTestName !== undefined && { suggestedTestName: args.suggestedTestName }),
						...(args.status !== undefined && { status: args.status }),
						...(args.dependsOnBehaviorIds !== undefined && {
							dependsOnBehaviorIds: args.dependsOnBehaviorIds,
						}),
					}),
				);
			}
			if (args.action === "delete") {
				return structuredJsonResult(await caller.tdd_behavior({ action: "delete", id: args.id as number }));
			}
			if (args.action === "get") {
				return structuredJsonResult(await caller.tdd_behavior({ action: "get", id: args.id as number }));
			}
			if (args.action === "list_by_goal") {
				return structuredJsonResult(
					await caller.tdd_behavior({ action: "list_by_goal", goalId: args.goalId as number }),
				);
			}
			return structuredJsonResult(
				await caller.tdd_behavior({ action: "list_by_tdd_task", tddTaskId: args.tddTaskId as number }),
			);
		},
	);

	// ── tdd_artifact_list (read-only artifact lookup) ──────────────────

	server.registerTool(
		"tdd_artifact_list",
		{
			description:
				"Use when you need the artifact id to cite in tdd_phase_transition_request without querying SQLite directly. Lists TDD artifacts (test_written, test_failed_run, code_written, test_passed_run, refactor, test_weakened) for a tdd_task, newest first. Filters: artifactKind, phaseId, behaviorId, limit (default 50).",
			inputSchema: {
				tddTaskId: z.coerce.number().describe("tdd_tasks.id"),
				artifactKind: z
					.optional(
						z.enum(["test_written", "test_failed_run", "code_written", "test_passed_run", "refactor", "test_weakened"]),
					)
					.describe("Restrict to one artifact kind"),
				phaseId: z.optional(z.coerce.number()).describe("Restrict to artifacts recorded in one phase"),
				behaviorId: z
					.optional(z.coerce.number())
					.describe("Restrict to artifacts recorded in phases bound to one behavior"),
				limit: z.optional(z.coerce.number()).describe("Max rows (default 50)"),
			},
			outputSchema: effectToZodSchema(TddArtifactListResult) as never,
		},
		async (args) => {
			const data = await caller.tdd_artifact_list({
				tddTaskId: args.tddTaskId as number,
				...(args.artifactKind !== undefined && { artifactKind: args.artifactKind }),
				...(args.phaseId !== undefined && { phaseId: args.phaseId }),
				...(args.behaviorId !== undefined && { behaviorId: args.behaviorId }),
				...(args.limit !== undefined && { limit: args.limit }),
			});
			const text = Schema.decodeSync(TddArtifactListAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Consolidated `hypothesis` tool (record / list / validate) ───────

	server.registerTool(
		"hypothesis",
		{
			description:
				"Use to manage debugging hypotheses, with a CRUD action discriminator: action='record' (sessionId, content, optional citation ids) writes a hypothesis; action='validate' (id, outcome, validatedAt) records a validation outcome; action='list' (sessionId?, outcome?, limit?) returns matching hypotheses as markdown.",
			inputSchema: {
				action: z.enum(["record", "validate", "list"]).describe("CRUD discriminator"),
				// Shared
				sessionId: z.optional(z.coerce.number()).describe("Session id (required for record; filter for list)"),
				// record
				content: z.optional(z.string()).describe("Hypothesis content (action=record)"),
				createdTurnId: z.optional(z.coerce.number()),
				citedTestErrorId: z.optional(z.coerce.number()),
				citedStackFrameId: z.optional(z.coerce.number()),
				// validate
				id: z.optional(z.coerce.number()).describe("Hypothesis id (action=validate)"),
				outcome: z
					.optional(z.enum(["confirmed", "refuted", "abandoned", "open"]))
					.describe("validate: 'confirmed'|'refuted'|'abandoned'; list filter may include 'open'"),
				validatedTurnId: z.optional(z.coerce.number()),
				validatedAt: z.optional(z.string()).describe("ISO 8601 timestamp (action=validate)"),
				// list
				limit: z.optional(z.coerce.number()),
			},
			outputSchema: effectToZodSchema(HypothesisResult) as never,
		},
		async (args) => {
			if (args.action === "record") {
				const result = await caller.hypothesis({
					action: "record",
					sessionId: args.sessionId as number,
					content: args.content as string,
					...(args.createdTurnId !== undefined && { createdTurnId: args.createdTurnId }),
					...(args.citedTestErrorId !== undefined && { citedTestErrorId: args.citedTestErrorId }),
					...(args.citedStackFrameId !== undefined && { citedStackFrameId: args.citedStackFrameId }),
				});
				return structuredJsonResult(result);
			}
			if (args.action === "validate") {
				const result = await caller.hypothesis({
					action: "validate",
					id: args.id as number,
					outcome: args.outcome as "confirmed" | "refuted" | "abandoned",
					validatedAt: args.validatedAt as string,
					...(args.validatedTurnId !== undefined && { validatedTurnId: args.validatedTurnId }),
				});
				return structuredJsonResult(result);
			}
			const result = await caller.hypothesis({
				action: "list",
				...(args.sessionId !== undefined && { sessionId: args.sessionId }),
				...(args.outcome !== undefined && { outcome: args.outcome }),
				...(args.limit !== undefined && { limit: args.limit }),
			});
			return structuredResult(formatHypothesisListMarkdown(result), result);
		},
	);

	// ── TDD progress push ──────────────────────────────────────────────

	server.registerTool(
		"tdd_progress_push",
		{
			description:
				"Use when a TDD orchestrator needs to report progress to the main agent over a Claude Code channel. The MCP server validates the payload against the ChannelEvent union and resolves goalId/sessionId server-side from behaviorId for behavior-scoped events (so a stale orchestrator context cannot push the wrong tree coordinates). Best-effort — returns { ok: true } regardless of whether channels are active.",
			inputSchema: {
				payload: z
					.string()
					.describe("Pre-stringified ChannelEvent JSON (see schemas/ChannelEvent in @vitest-agent/sdk)"),
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
			return structuredJsonResult({ ok: true });
		},
	);

	// ── Acceptance metrics ──────────────────────────────────────────────

	server.registerTool(
		"acceptance_metrics",
		{
			description:
				"Use when you need the four spec Annex A acceptance metrics computed from the current database. Returns markdown in content[] and a typed JSON object in structuredContent (per-metric { total, ratio, ... }).",
			inputSchema: {},
			outputSchema: effectToZodSchema(AcceptanceMetricsResult) as never,
		},
		async () => {
			const data = await caller.acceptance_metrics({});
			const text = Schema.decodeSync(AcceptanceMetricsAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// ── Triage brief ────────────────────────────────────────────────────

	server.registerTool(
		"triage_brief",
		{
			description:
				"Use when you need to orient on the current test landscape: failing tests, flaky tests, open TDD sessions, and suggested next actions. Returns markdown in content[] and a typed envelope in structuredContent ({ hasContent, markdown }).",
			inputSchema: {
				project: z.optional(z.string()).describe("Filter to a specific project"),
				maxLines: z.optional(z.coerce.number()).describe("Soft cap on rendered output lines"),
			},
			outputSchema: effectToZodSchema(TriageBriefResult) as never,
		},
		async (args) => {
			const data = await caller.triage_brief({ project: args.project, maxLines: args.maxLines });
			return structuredResult(data.markdown, data);
		},
	);

	// ── Wrapup prompt ───────────────────────────────────────────────────

	server.registerTool(
		"wrapup_prompt",
		{
			description:
				"Use when a session is ending and you need a tailored wrap-up prompt (Stop / SessionEnd / PreCompact / TDD handoff / UserPromptSubmit nudge variants). Returns markdown in content[] and a typed envelope in structuredContent ({ hasContent, kind, markdown }).",
			inputSchema: {
				sessionId: z.optional(z.coerce.number()).describe("sessions.id (integer); omit to use chatId"),
				chatId: z.optional(z.string()).describe("Host chat UUID (alternative to sessionId)"),
				kind: z
					.optional(z.enum(["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]))
					.describe("Wrap-up flavor (default: session_end)"),
				userPromptHint: z.optional(z.string()).describe("For user_prompt_nudge: the prompt text to inspect"),
			},
			outputSchema: effectToZodSchema(WrapupPromptResult) as never,
		},
		async (args) => {
			const data = await caller.wrapup_prompt({
				sessionId: args.sessionId,
				chatId: args.chatId,
				kind: args.kind,
				userPromptHint: args.userPromptHint,
			});
			return structuredResult(data.markdown, data);
		},
	);

	server.registerTool(
		"commit_changes",
		{
			description:
				"Use when you need commit metadata and changed files captured by the post-commit hook. Returns up to 20 most-recent when sha is omitted. Returns markdown in content[] and a typed JSON object in structuredContent ({ filterSha?, count, commits[] }).",
			inputSchema: {
				sha: z.optional(z.string()).describe("Specific commit sha to fetch; omit for recent commits"),
			},
			outputSchema: effectToZodSchema(CommitChangesResult) as never,
		},
		async (args) => {
			const data = await caller.commit_changes({ sha: args.sha });
			const text = Schema.decodeSync(CommitChangesAsMarkdown)(data);
			return structuredResult(text, data);
		},
	);

	// Note: get_current_session_id and set_current_session_id were removed
	// in Phase 3 of the agent-agnostic taxonomy work. The session id is now
	// recovered at MCP boot from process.env (CLAUDE_ENV_FILE auto-source
	// from SessionStart) and stored on McpContext.sessionContext;
	// session-aware tools consult that ref directly.

	server.registerTool(
		"ping",
		{
			description:
				"Use when you need to verify the MCP server is alive or confirm a hot-patch reload. Returns 'pong'; structuredContent.message carries the constant 'pong' literal.",
			outputSchema: effectToZodSchema(PingResult) as never,
		},
		async () => {
			const data = await caller.ping();
			return structuredResult(data.message, data);
		},
	);

	registerAllPrompts(server);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}
