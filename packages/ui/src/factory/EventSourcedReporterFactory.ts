/**
 * Reporter factory backed by the event-sourced renderer.
 *
 * Implements `VitestAgentReporterFactory` from the SDK so it slots
 * into the plugin's `reporter` option exactly like any other named
 * factory. The render call loops over `input.reports`, synthesizes a
 * RunEvent stream from each report, and emits one stdout-targeted
 * RenderedOutput per project carrying the rendered string.
 *
 * Mode selection:
 *
 * - `kit.config.mode === "silent"` → no output emitted.
 * - `kit.config.mode === "human"` → Ink `renderToString` output.
 * - everything else (`agent`, `auto`) → the agent-mode renderer.
 *
 * The plugin has already resolved `auto` against env detection before
 * the factory is called, so the factory never has to probe TTY or
 * inspect environment variables itself.
 *
 * @packageDocumentation
 */

import type {
	ConsoleMode,
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	VitestAgentReporter,
	VitestAgentReporterFactory,
} from "vitest-agent-sdk";
import type { RenderRunMode } from "../render-run.js";
import { renderRun } from "../render-run.js";
import { synthesizeFromAgentReport } from "../synthesize.js";

export interface EventSourcedReporterOptions {
	/**
	 * Override the resolved {@link ConsoleMode}. Useful for forcing a
	 * particular layout without changing the plugin-level matrix — e.g.
	 * mounting the Ink view in a CI environment where the plugin would
	 * otherwise pick ci-annotations.
	 */
	readonly modeOverride?: ConsoleMode;
	/**
	 * Target column width passed to the underlying renderer.
	 *
	 * @defaultValue 80
	 */
	readonly width?: number;
}

const resolveRunMode = (mode: ConsoleMode): RenderRunMode | "silent" => {
	if (mode === "silent" || mode === "passthrough") return "silent";
	// `ink` defers the visible work to a live Ink mount driven through
	// `onRunEvent` (typically `createLiveInk`). The end-of-run factory
	// stays quiet to avoid duplicating the final frame the live mount
	// has already painted.
	if (mode === "ink") return "silent";
	// `ci-annotations` is rendered by a dedicated CI reporter; this
	// factory contributes no stdout output for that mode.
	if (mode === "ci-annotations") return "silent";
	return "agent";
};

const renderOne = (
	report: ReporterRenderInput["reports"][number],
	runMode: RenderRunMode,
	width: number,
): RenderedOutput => {
	const events = synthesizeFromAgentReport(report);
	const content = renderRun(events, runMode, { width });
	return { target: "stdout", content: `${content}\n`, contentType: "text/plain" };
};

/**
 * Build a reporter factory bound to the supplied options.
 *
 * Returns a `VitestAgentReporterFactory` ready to plug into the
 * plugin's `reporter` option.
 */
export const makeEventSourcedReporter = (options: EventSourcedReporterOptions = {}): VitestAgentReporterFactory =>
	((kit: ReporterKit): VitestAgentReporter => {
		const resolvedMode = options.modeOverride ?? kit.config.consoleMode;
		const runMode = resolveRunMode(resolvedMode);
		const width = options.width ?? 80;

		return {
			render(input: ReporterRenderInput): ReadonlyArray<RenderedOutput> {
				if (runMode === "silent") return [];
				return input.reports.map((report) => renderOne(report, runMode, width));
			},
		};
	}) satisfies VitestAgentReporterFactory;

/**
 * Default-options instance, suitable for direct use as the `reporter`
 * option without further configuration.
 *
 * @example
 * ```ts
 * import { eventSourcedReporter } from "vitest-agent-ui";
 * import { AgentPlugin } from "vitest-agent-plugin";
 *
 * AgentPlugin({ reporter: eventSourcedReporter });
 * ```
 */
export const eventSourcedReporter: VitestAgentReporterFactory = makeEventSourcedReporter();
