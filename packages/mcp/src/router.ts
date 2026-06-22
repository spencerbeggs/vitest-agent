import { router } from "./context.js";
import { acceptanceMetrics } from "./tools/acceptance-metrics.js";
import { cacheHealth } from "./tools/cache-health.js";
import { commitChanges } from "./tools/commit-changes.js";
import { configure } from "./tools/configure.js";
import { testCoverage } from "./tools/coverage.js";
import { testErrors } from "./tools/errors.js";
import { failureSignatureGet } from "./tools/failure-signature-get.js";
import { fileCoverage } from "./tools/file-coverage.js";
import { help } from "./tools/help.js";
import { testHistory } from "./tools/history.js";
import { hypothesis } from "./tools/hypothesis.js";
import { inventory } from "./tools/inventory.js";
import { note } from "./tools/note.js";
import { testOverview } from "./tools/overview.js";
import { ping } from "./tools/ping.js";
import { registerAgent } from "./tools/register-agent.js";
import { runTests } from "./tools/run-tests.js";
import { settingsList } from "./tools/settings-list.js";
import { testStatus } from "./tools/status.js";
import { tddArtifactList } from "./tools/tdd-artifact.js";
import { tddBehavior } from "./tools/tdd-behavior.js";
import { tddGoal } from "./tools/tdd-goal.js";
import { tddPhaseTransitionRequest } from "./tools/tdd-phase-transition-request.js";
import { tddTask } from "./tools/tdd-task.js";
import { test } from "./tools/test.js";
import { testTrends } from "./tools/trends.js";
import { triageBrief } from "./tools/triage-brief.js";
import { turnSearch } from "./tools/turn-search.js";
import { wrapupPrompt } from "./tools/wrapup-prompt.js";

/**
 * The tRPC router aggregating all MCP tool procedures.
 *
 * Pass to `createCallerFactory` in tests, or to `createCallerFactory(appRouter)`
 * followed by `startMcpServer` in the bin entry to start the MCP server.
 *
 * @public
 */
export const appRouter = router({
	help: help,
	test_status: testStatus,
	test_overview: testOverview,
	test_coverage: testCoverage,
	test_history: testHistory,
	test_trends: testTrends,
	test_errors: testErrors,
	test: test,
	file_coverage: fileCoverage,
	run_tests: runTests,
	register_agent: registerAgent,
	cache_health: cacheHealth,
	configure: configure,
	inventory: inventory,
	settings_list: settingsList,
	note: note,
	turn_search: turnSearch,
	failure_signature_get: failureSignatureGet,
	tdd_task: tddTask,
	tdd_phase_transition_request: tddPhaseTransitionRequest,
	tdd_goal: tddGoal,
	tdd_behavior: tddBehavior,
	tdd_artifact_list: tddArtifactList,
	hypothesis: hypothesis,
	acceptance_metrics: acceptanceMetrics,
	triage_brief: triageBrief,
	wrapup_prompt: wrapupPrompt,
	commit_changes: commitChanges,
	ping: ping,
});

export type AppRouter = typeof appRouter;
