/**
 * Reporter factories for the vitest-agent plugin.
 *
 * The preassembled default reporter (_defaultReporter) implements the
 * VitestAgentReporterFactory contract from the SDK and ships the T6
 * shape-tailored dispatcher pipeline. The plugin wires it as its
 * built-in when no user reporter option is supplied. The legacy
 * eventSourcedReporter and createLiveInk exports were removed in
 * phase 9 of the T6 rewrite; _createLiveInk stays as an internal
 * symbol for the plugin's live Ink mount.
 *
 * @packageDocumentation
 */

export {
	_defaultReporter,
	buildDispatchInputs,
	renderAgentStringForReport,
	renderHumanStringForReport,
	resolveCellOptions,
} from "./defaultReporter.js";
export {
	type CreateLiveInkOptions,
	type LiveInkRenderer,
	createLiveInk as _createLiveInk,
} from "./LiveInkRenderer.js";
