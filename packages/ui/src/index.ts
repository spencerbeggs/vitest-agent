/**
 * vitest-agent-ui
 *
 * Shared event-sourced renderer for vitest-agent. The reducer projects
 * a {@link RunEvent} stream into a denormalized {@link RenderState};
 * the Ink human-mode renderer and the plain-string agent-mode renderer
 * each consume the projected state.
 *
 * Phase 1 of the rollout exports only the event taxonomy and the
 * render-state shape — the reducer, the agent renderer, the Ink
 * components, and the PubSub Layer arrive in subsequent phases.
 *
 * @packageDocumentation
 */

export type { RunEventByTag } from "vitest-agent-sdk";
export {
	ActionSeverity,
	CoverageFile,
	CoverageGap,
	CoverageMetric,
	CoverageRenderState,
	FailureRecord,
	ModuleRecord,
	RenderState,
	RenderTotals,
	RunEvent,
	SuggestedActionRecord,
	TestRecord,
	initialRenderState,
} from "vitest-agent-sdk";
export * from "./factory/index.js";
export * from "./pubsub/index.js";
export { reduceRenderState, reduceRenderStateAll } from "./reducer.js";
export { type RenderAgentOptions, renderAgent } from "./render-agent.js";
export * from "./render-ink/index.js";
export {
	type RenderRunMode,
	type RenderRunOptions,
	renderRun,
	renderRunFromState,
} from "./render-run.js";
export {
	type SynthesizeFromAgentReportOptions,
	type SynthesizeOptions,
	type SynthesizedCoverage,
	synthesizeFromAgentReport,
	synthesizeRunEvents,
} from "./synthesize.js";
