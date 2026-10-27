/**
 * @vitest-agent/mcp
 *
 * Model Context Protocol server for vitest-agent, built on Effect's
 * native `McpServer` (`effect/ai`). Exposes 30 tools (one
 * tool per file under `tools/`, assembled in `toolkit.ts` and registered
 * strict-by-default through `@effected/mcp`'s `McpToolkit.layer`)
 * plus six framing prompts (`prompts/layer.ts`) over stdio, giving agents
 * structured access to test data, coverage, history, trends, errors,
 * notes and the TDD lifecycle — backed by the SQLite database that the
 * reporter writes during test runs.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent-mcp` bin) over `main.ts` (published as `./main` so the
 * carrier can ship the same bin); this barrel re-exports the supporting
 * pieces for programmatic use and never imports `main.ts`.
 *
 * @packageDocumentation
 */

// The refusal the `hypothesis` / `tdd_task` handlers fail with is the kit's;
// re-exported so an embedder's `catchTag("ToolRefusal", ...)` imports it from here.
export { ToolRefusal } from "@effected/mcp";
export { RenderText } from "./annotations.js";
export { PromptsLayer } from "./prompts/layer.js";
export type { PlatformServices, ServerLayerOptions } from "./server.js";
export { SERVER_INSTRUCTIONS, ServerLayer } from "./server.js";
export type { CurrentSessionIdRef, McpSessionOptions, SessionContext, SessionContextRef } from "./session.js";
export { McpSession, createCurrentSessionIdRef, createSessionContextRef, sessionContextFromEnv } from "./session.js";
export { Kit, ToolsLayer, toolHandlers } from "./toolkit.js";
// `parseSessionEnvExports` / `recoverSessionContextFromSessionEnv` moved
// to `@vitest-agent/engine` (#412); import them from there.
export type { Remediation, TddErrorEnvelope } from "./tools/_tdd-error-envelope.js";
export type { AcceptanceMetricsResultType } from "./tools/acceptance-metrics.js";
export { AcceptanceMetricsResult, acceptanceMetricsTool, handleAcceptanceMetrics } from "./tools/acceptance-metrics.js";
export type { CacheHealthResultType } from "./tools/cache-health.js";
export { CacheHealthResult, cacheHealthTool, handleCacheHealth } from "./tools/cache-health.js";
export type { CommitChangesInputType, CommitChangesResultType } from "./tools/commit-changes.js";
export {
	CommitChangesInput,
	CommitChangesResult,
	commitChangesTool,
	handleCommitChanges,
} from "./tools/commit-changes.js";
export type { ConfigureInputType, ConfigureResultType } from "./tools/configure.js";
export { ConfigureInput, ConfigureResult, configureTool, handleConfigure } from "./tools/configure.js";
export type { TestCoverageInputType, TestCoverageResultType } from "./tools/coverage.js";
export { TestCoverageInput, TestCoverageResult, handleTestCoverage, testCoverageTool } from "./tools/coverage.js";
export type { TestErrorsInputType, TestErrorsResultType } from "./tools/errors.js";
export { TestErrorsInput, TestErrorsResult, handleTestErrors, testErrorsTool } from "./tools/errors.js";
export type { FailureSignatureGetInputType, FailureSignatureGetResultType } from "./tools/failure-signature-get.js";
export {
	FailureSignatureGetInput,
	FailureSignatureGetResult,
	failureSignatureGetTool,
	handleFailureSignatureGet,
} from "./tools/failure-signature-get.js";
export type { FileCoverageInputType, FileCoverageResultType } from "./tools/file-coverage.js";
export { FileCoverageInput, FileCoverageResult, fileCoverageTool, handleFileCoverage } from "./tools/file-coverage.js";
export type { HelpResultType } from "./tools/help.js";
export { HelpResult, handleHelp, helpTool } from "./tools/help.js";
export type { TestHistoryInputType, TestHistoryResultType } from "./tools/history.js";
export { TestHistoryInput, TestHistoryResult, handleTestHistory, testHistoryTool } from "./tools/history.js";
export type { HypothesisInputType, HypothesisResultType } from "./tools/hypothesis.js";
export { HypothesisInput, HypothesisResult, handleHypothesis, hypothesisTool } from "./tools/hypothesis.js";
export type { InventoryInputType, InventoryResultType } from "./tools/inventory.js";
export { InventoryInput, InventoryResult, handleInventory, inventoryTool } from "./tools/inventory.js";
export type { NoteParamsType, NoteResultType } from "./tools/note.js";
export { NoteParams, NoteResult, handleNote, noteTool } from "./tools/note.js";
export type { TestOverviewInputType, TestOverviewResultType } from "./tools/overview.js";
export { TestOverviewInput, TestOverviewResult, handleTestOverview, testOverviewTool } from "./tools/overview.js";
export type { PingResultType } from "./tools/ping.js";
export { PingResult, handlePing, pingTool } from "./tools/ping.js";
export type { RegisterAgentInputType, RegisterAgentOutput } from "./tools/register-agent.js";
export {
	RegisterAgentInput,
	RegisterAgentResult,
	handleRegisterAgent,
	registerAgentTool,
} from "./tools/register-agent.js";
export type { RunTestsInputType, RunTestsResultType } from "./tools/run-tests.js";
export { RunTestsInput, RunTestsResult, handleRunTests, runTestsTool } from "./tools/run-tests.js";
export type { SettingsListResultType } from "./tools/settings-list.js";
export { SettingsListResult, handleSettingsList, settingsListTool } from "./tools/settings-list.js";
export type { TestStatusInputType, TestStatusResultType } from "./tools/status.js";
export { TestStatusInput, TestStatusResult, handleTestStatus, testStatusTool } from "./tools/status.js";
export type { TddArtifactListInputType, TddArtifactListResultType } from "./tools/tdd-artifact.js";
export {
	TddArtifactListInput,
	TddArtifactListResult,
	handleTddArtifactList,
	tddArtifactListTool,
} from "./tools/tdd-artifact.js";
export type { TddBehaviorInputType, TddBehaviorResultType } from "./tools/tdd-behavior.js";
export { TddBehaviorInput, TddBehaviorResult, handleTddBehavior, tddBehaviorTool } from "./tools/tdd-behavior.js";
export type { TddGoalInputType, TddGoalResultType } from "./tools/tdd-goal.js";
export { TddGoalInput, TddGoalResult, handleTddGoal, tddGoalTool } from "./tools/tdd-goal.js";
export type { PhaseTransitionInputType, PhaseTransitionResultType } from "./tools/tdd-phase-transition-request.js";
export {
	PhaseTransitionInput,
	PhaseTransitionResult,
	handlePhaseTransitionRequest,
	tddPhaseTransitionRequestTool,
} from "./tools/tdd-phase-transition-request.js";
export type { TddProgressPushInputType, TddProgressPushResultType } from "./tools/tdd-progress-push.js";
export {
	TddProgressPushInput,
	TddProgressPushResult,
	handleTddProgressPush,
	tddProgressPushTool,
} from "./tools/tdd-progress-push.js";
export type { TddTaskInputType, TddTaskResultType } from "./tools/tdd-task.js";
export { TddTaskInput, TddTaskResult, handleTddTask, tddTaskTool } from "./tools/tdd-task.js";
export type { TestInputType, TestResultType } from "./tools/test.js";
export { TestInput, TestResult, handleTest, testTool } from "./tools/test.js";
export type { TestTrendsInputType, TestTrendsResultType } from "./tools/trends.js";
export { TestTrendsInput, TestTrendsResult, handleTestTrends, testTrendsTool } from "./tools/trends.js";
export type { TriageBriefInputType, TriageBriefResultType } from "./tools/triage-brief.js";
export { TriageBriefInput, TriageBriefResult, handleTriageBrief, triageBriefTool } from "./tools/triage-brief.js";
export type { TurnSearchInputType, TurnSearchResultType } from "./tools/turn-search.js";
export { TurnSearchInput, TurnSearchResult, handleTurnSearch, turnSearchTool } from "./tools/turn-search.js";
export type { WrapupPromptInputType, WrapupPromptResultType } from "./tools/wrapup-prompt.js";
export { WrapupPromptInput, WrapupPromptResult, handleWrapupPrompt, wrapupPromptTool } from "./tools/wrapup-prompt.js";
export { CURRENT_MCP_VERSION } from "./version.js";
