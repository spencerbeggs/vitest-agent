/**
 * @vitest-agent/mcp
 *
 * Model Context Protocol server for vitest-agent, built on Effect's
 * native `McpServer` (`effect/unstable/ai`). Exposes 30 tools (one
 * `Tool.make` per file under `tools/`, assembled in `toolkit.ts` and
 * registered under the strict-input contract by `register-toolkit.ts`)
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

export { RenderText } from "./annotations.js";
export { withIdempotency } from "./idempotency.js";
export { PromptsLayer } from "./prompts/layer.js";
export { registerStrictToolkit } from "./register-toolkit.js";
export type { PlatformServices, ServerLayerOptions } from "./server.js";
export { ServerLayer } from "./server.js";
export type { CurrentSessionIdRef, McpSessionOptions, SessionContext, SessionContextRef } from "./session.js";
export { McpSession, createCurrentSessionIdRef, createSessionContextRef, sessionContextFromEnv } from "./session.js";
export { Kit, ToolsLayer, toolHandlers } from "./toolkit.js";
// `parseSessionEnvExports` / `recoverSessionContextFromSessionEnv` moved
// to `@vitest-agent/engine` (#412); import them from there.
export type { Remediation, TddErrorEnvelope } from "./tools/_tdd-error-envelope.js";
export type { AcceptanceMetricsResultType } from "./tools/acceptance-metrics.js";
export { AcceptanceMetricsResult } from "./tools/acceptance-metrics.js";
export type { CacheHealthResultType } from "./tools/cache-health.js";
export { CacheHealthResult } from "./tools/cache-health.js";
export type { CommitChangesInputType, CommitChangesResultType } from "./tools/commit-changes.js";
export { CommitChangesInput, CommitChangesResult } from "./tools/commit-changes.js";
export type { ConfigureInputType, ConfigureResultType } from "./tools/configure.js";
export { ConfigureInput, ConfigureResult } from "./tools/configure.js";
export type { TestCoverageInputType, TestCoverageResultType } from "./tools/coverage.js";
export { TestCoverageInput, TestCoverageResult } from "./tools/coverage.js";
export type { TestErrorsInputType, TestErrorsResultType } from "./tools/errors.js";
export { TestErrorsInput, TestErrorsResult } from "./tools/errors.js";
export type { FailureSignatureGetInputType, FailureSignatureGetResultType } from "./tools/failure-signature-get.js";
export { FailureSignatureGetInput, FailureSignatureGetResult } from "./tools/failure-signature-get.js";
export type { FileCoverageInputType, FileCoverageResultType } from "./tools/file-coverage.js";
export { FileCoverageInput, FileCoverageResult } from "./tools/file-coverage.js";
export type { HelpResultType } from "./tools/help.js";
export { HelpResult } from "./tools/help.js";
export type { TestHistoryInputType, TestHistoryResultType } from "./tools/history.js";
export { TestHistoryInput, TestHistoryResult } from "./tools/history.js";
export type { InventoryInputType, InventoryResultType } from "./tools/inventory.js";
export { InventoryInput, InventoryResult } from "./tools/inventory.js";
export type { NoteParamsType, NoteResultType } from "./tools/note.js";
export { NoteParams, NoteResult } from "./tools/note.js";
export type { TestOverviewInputType, TestOverviewResultType } from "./tools/overview.js";
export { TestOverviewInput, TestOverviewResult } from "./tools/overview.js";
export type { PingResultType } from "./tools/ping.js";
export { PingResult } from "./tools/ping.js";
export type { RegisterAgentInputType, RegisterAgentOutput } from "./tools/register-agent.js";
export { RegisterAgentInput, RegisterAgentResult } from "./tools/register-agent.js";
export type { RunTestsInputType, RunTestsResultType } from "./tools/run-tests.js";
export { RunTestsInput, RunTestsResult } from "./tools/run-tests.js";
export type { SettingsListResultType } from "./tools/settings-list.js";
export { SettingsListResult } from "./tools/settings-list.js";
export type { TestStatusInputType, TestStatusResultType } from "./tools/status.js";
export { TestStatusInput, TestStatusResult } from "./tools/status.js";
export type { TddArtifactListInputType, TddArtifactListResultType } from "./tools/tdd-artifact.js";
export { TddArtifactListInput, TddArtifactListResult } from "./tools/tdd-artifact.js";
export type { PhaseTransitionInputType, PhaseTransitionResultType } from "./tools/tdd-phase-transition-request.js";
export { PhaseTransitionInput, PhaseTransitionResult } from "./tools/tdd-phase-transition-request.js";
export type { TddProgressPushInputType, TddProgressPushResultType } from "./tools/tdd-progress-push.js";
export { TddProgressPushInput, TddProgressPushResult } from "./tools/tdd-progress-push.js";
export type { TestInputType, TestResultType } from "./tools/test.js";
export { TestInput, TestResult } from "./tools/test.js";
export type { TestTrendsInputType, TestTrendsResultType } from "./tools/trends.js";
export { TestTrendsInput, TestTrendsResult } from "./tools/trends.js";
export type { TriageBriefInputType, TriageBriefResultType } from "./tools/triage-brief.js";
export { TriageBriefInput, TriageBriefResult } from "./tools/triage-brief.js";
export type { TurnSearchInputType, TurnSearchResultType } from "./tools/turn-search.js";
export { TurnSearchInput, TurnSearchResult } from "./tools/turn-search.js";
export type { WrapupPromptInputType, WrapupPromptResultType } from "./tools/wrapup-prompt.js";
export { WrapupPromptInput, WrapupPromptResult } from "./tools/wrapup-prompt.js";
export { CURRENT_MCP_VERSION } from "./version.js";
