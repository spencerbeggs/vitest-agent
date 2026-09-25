// The Effect-native tool surface: one `Toolkit` gathering every tool, the
// handler record, and the handlers layer `McpToolkit.layer` requires.

import { Toolkit } from "effect/unstable/ai";
import { withIdempotency } from "./idempotency.js";
import { decodeStrictUnion } from "./tools/_union-schema.js";
import { acceptanceMetricsTool, handleAcceptanceMetrics } from "./tools/acceptance-metrics.js";
import { cacheHealthTool, handleCacheHealth } from "./tools/cache-health.js";
import { commitChangesTool, handleCommitChanges } from "./tools/commit-changes.js";
import { configureTool, handleConfigure } from "./tools/configure.js";
import { handleTestCoverage, testCoverageTool } from "./tools/coverage.js";
import { handleTestErrors, testErrorsTool } from "./tools/errors.js";
import { failureSignatureGetTool, handleFailureSignatureGet } from "./tools/failure-signature-get.js";
import { fileCoverageTool, handleFileCoverage } from "./tools/file-coverage.js";
import { handleHelp, helpTool } from "./tools/help.js";
import { handleTestHistory, testHistoryTool } from "./tools/history.js";
import { HypothesisInput, handleHypothesis, hypothesisTool } from "./tools/hypothesis.js";
import { InventoryInput, handleInventory, inventoryTool } from "./tools/inventory.js";
import { NoteParams, handleNote, noteTool } from "./tools/note.js";
import { handleTestOverview, testOverviewTool } from "./tools/overview.js";
import { handlePing, pingTool } from "./tools/ping.js";
import { handleRegisterAgent, registerAgentTool } from "./tools/register-agent.js";
import { handleRunTests, runTestsTool } from "./tools/run-tests.js";
import { handleSettingsList, settingsListTool } from "./tools/settings-list.js";
import { handleTestStatus, testStatusTool } from "./tools/status.js";
import { handleTddArtifactList, tddArtifactListTool } from "./tools/tdd-artifact.js";
import { TddBehaviorInput, handleTddBehavior, tddBehaviorTool } from "./tools/tdd-behavior.js";
import { TddGoalInput, handleTddGoal, tddGoalTool } from "./tools/tdd-goal.js";
import { handlePhaseTransitionRequest, tddPhaseTransitionRequestTool } from "./tools/tdd-phase-transition-request.js";
import { handleTddProgressPush, tddProgressPushTool } from "./tools/tdd-progress-push.js";
import { TddTaskInput, handleTddTask, tddTaskTool } from "./tools/tdd-task.js";
import { TestInput, handleTest, testTool } from "./tools/test.js";
import { handleTestTrends, testTrendsTool } from "./tools/trends.js";
import { handleTriageBrief, triageBriefTool } from "./tools/triage-brief.js";
import { handleTurnSearch, turnSearchTool } from "./tools/turn-search.js";
import { handleWrapupPrompt, wrapupPromptTool } from "./tools/wrapup-prompt.js";

/**
 * Every tool the server registers.
 *
 * @public
 */
export const Kit = Toolkit.make(
	pingTool,
	helpTool,
	testStatusTool,
	testOverviewTool,
	testCoverageTool,
	testHistoryTool,
	testTrendsTool,
	testErrorsTool,
	fileCoverageTool,
	settingsListTool,
	cacheHealthTool,
	configureTool,
	commitChangesTool,
	turnSearchTool,
	failureSignatureGetTool,
	acceptanceMetricsTool,
	triageBriefTool,
	wrapupPromptTool,
	inventoryTool,
	testTool,
	registerAgentTool,
	noteTool,
	hypothesisTool,
	tddTaskTool,
	tddPhaseTransitionRequestTool,
	tddGoalTool,
	tddBehaviorTool,
	tddArtifactListTool,
	tddProgressPushTool,
	runTestsTool,
);

/**
 * The handler for each tool in {@link Kit}, keyed by tool name. The seven
 * action-keyed tools are `Tool.dynamic` (a union root cannot be a `Tool.make`
 * parameters schema), so their handlers take the raw payload and decode it
 * through `decodeStrictUnion`.
 *
 * @public
 */
export const toolHandlers = {
	ping: handlePing,
	help: handleHelp,
	test_status: handleTestStatus,
	test_overview: handleTestOverview,
	test_coverage: handleTestCoverage,
	test_history: handleTestHistory,
	test_trends: handleTestTrends,
	test_errors: handleTestErrors,
	file_coverage: handleFileCoverage,
	settings_list: handleSettingsList,
	cache_health: handleCacheHealth,
	configure: handleConfigure,
	commit_changes: handleCommitChanges,
	turn_search: handleTurnSearch,
	failure_signature_get: handleFailureSignatureGet,
	acceptance_metrics: handleAcceptanceMetrics,
	triage_brief: handleTriageBrief,
	wrapup_prompt: handleWrapupPrompt,
	inventory: decodeStrictUnion(inventoryTool, InventoryInput, handleInventory),
	test: decodeStrictUnion(testTool, TestInput, handleTest),
	register_agent: handleRegisterAgent,
	note: decodeStrictUnion(noteTool, NoteParams, handleNote),
	hypothesis: decodeStrictUnion(hypothesisTool, HypothesisInput, withIdempotency("hypothesis", handleHypothesis)),
	tdd_task: decodeStrictUnion(tddTaskTool, TddTaskInput, withIdempotency("tdd_task", handleTddTask)),
	tdd_phase_transition_request: handlePhaseTransitionRequest,
	tdd_goal: decodeStrictUnion(tddGoalTool, TddGoalInput, withIdempotency("tdd_goal", handleTddGoal)),
	tdd_behavior: decodeStrictUnion(
		tddBehaviorTool,
		TddBehaviorInput,
		withIdempotency("tdd_behavior", handleTddBehavior),
	),
	tdd_artifact_list: handleTddArtifactList,
	tdd_progress_push: handleTddProgressPush,
	run_tests: handleRunTests,
} satisfies Toolkit.HandlersFrom<typeof Kit.tools>;

/**
 * The handlers layer: provides `Tool.HandlersFor<typeof Kit.tools>`.
 *
 * @public
 */
export const ToolsLayer = Kit.toLayer(toolHandlers);
