/**
 * vitest-agent-ui
 *
 * Shared event-sourced renderer for vitest-agent. The reducer projects
 * a {@link RunEvent} stream into a denormalized {@link RenderState};
 * the T6 shape-tailored dispatcher then routes the state to one of
 * twelve cells (eleven live, one documented no-op) and emits both
 * an agent-string and an Ink-tree output.
 *
 * This file is the package entrypoint and is the only file in this
 * package that re-exports across module boundaries. Internal code
 * imports directly from the source file that owns the symbol.
 *
 * @packageDocumentation
 */

export type {
	CellOptions,
	DispatchInputs,
	ProjectSummary,
	RunEventByTag,
	RunOutcome,
	RunShape,
	TrendSummary,
} from "vitest-agent-sdk";
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
// Dispatcher surface (T6 UI rewrite) — internal callers can use these
// to drive the same code paths the preassembled default reporter uses.
export type { AgentCellFn, Cell, InkCellFn } from "./dispatcher/cell-types.js";
export { classifyOutcome, classifyRunShape } from "./dispatcher/classify.js";
export { dispatch, dispatchInk, dispatcherTable } from "./dispatcher/dispatch.js";
export { buildFooter, dominantClassification } from "./dispatcher/footer.js";
// Factory surface.
export {
	_defaultReporter,
	buildDispatchInputs,
	renderAgentStringForReport,
	renderHumanStringForReport,
	resolveCellOptions,
} from "./factory/defaultReporter.js";
export {
	type CreateLiveInkOptions,
	type LiveInkRenderer,
	createLiveInk as _createLiveInk,
} from "./factory/LiveInkRenderer.js";
// PubSub channel (live-event transport).
export * from "./pubsub/index.js";
// Reducer + agent renderer + Ink components + synthesizers.
export { reduceRenderState, reduceRenderStateAll } from "./reducer.js";
export { type RenderAgentOptions, renderAgent } from "./render-agent.js";
export * from "./render-ink/index.js";
export {
	type SynthesizeFromAgentReportOptions,
	type SynthesizeOptions,
	type SynthesizedCoverage,
	synthesizeFromAgentReport,
	synthesizeRunEvents,
} from "./synthesize.js";

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * The UI package is consumed through the plugin so it does not run its own
 * init-time drift check, but the constant is exported so the plugin can
 * compare against it. See the root CLAUDE.md "Cross-package version drift"
 * section.
 */
export const CURRENT_UI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
