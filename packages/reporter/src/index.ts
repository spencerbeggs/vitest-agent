/**
 * @vitest-agent/reporter
 *
 * The default reporter for the vitest-agent plugin — and the canonical
 * worked example for authors building their own.
 *
 * `DefaultVitestAgentReporter` is the preassembled `VitestAgentReporterFactory`
 * the plugin wires as its built-in when the user's `reporter` option is
 * unset. It branches on every `consoleMode`, dispatches through the
 * shape × outcome matrix, and owns the live Ink mount lifecycle end to
 * end. A custom-reporter author depends on this package, reads
 * `DefaultVitestAgentReporter` next to their own code, and gets the
 * reporter contract types plus the `buildDispatchInputs` /
 * `resolveCellOptions` dispatch helpers from one import — no direct
 * dependency on `@vitest-agent/sdk` or `@vitest-agent/ui` required.
 *
 * @packageDocumentation
 */

// Reporter contract type re-exports from the SDK so a custom-reporter
// author can pull everything they need from one package without adding
// @vitest-agent/sdk as a direct dependency.
export type {
	// SDK types that appear in the public ReporterKit / ReporterRenderInput surface
	AgentReport,
	// Dispatcher types referenced by buildDispatchInputs / resolveCellOptions
	CellOptions,
	ConsoleMode,
	DetailLevel,
	DispatchInputs,
	Environment,
	Executor,
	FileCoverageReport,
	OutputFormat,
	ProjectSummary,
	RenderState,
	// Core reporter contract types
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	ResolvedReporterConfig,
	ResolvedThresholds,
	RunEvent,
	RunOutcome,
	RunShape,
	TestClassification,
	Transport,
	TrendSummary,
	VitestAgentReporter,
	VitestAgentReporterFactory,
} from "@vitest-agent/sdk";
// --- The default reporter + its dispatch helpers ---
export {
	DefaultVitestAgentReporter,
	buildDispatchInputs,
	renderAgentStringForReport,
	renderHumanStringForReport,
	resolveCellOptions,
} from "./defaultReporter.js";
// --- Live Ink mount driver (internal to the default reporter) ---
export {
	type CreateLiveInkOptions,
	type LiveInkRenderer,
	createLiveInk as _createLiveInk,
} from "./LiveInkRenderer.js";

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * The reporter is consumed through the plugin so it does not run its own
 * init-time drift check, but the constant is exported so the plugin can
 * compare against it. See the root CLAUDE.md "Cross-package version drift"
 * section.
 *
 * @public
 */
export const CURRENT_REPORTER_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
