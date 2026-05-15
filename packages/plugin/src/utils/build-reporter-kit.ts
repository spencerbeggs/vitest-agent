/**
 * Assemble a {@link ReporterKit} from a fully-resolved reporter config.
 *
 * The plugin calls this once per run, after the data pipeline has resolved
 * `env` (via EnvironmentDetector), `executor` (via ExecutorResolver),
 * `format` (via FormatSelector), and `detail` (via DetailResolver). The
 * resulting kit is passed to the user's `VitestAgentReporterFactory` and
 * is also handed to the built-in default reporter when no factory is
 * supplied.
 *
 * @internal
 */

import type {
	ConsoleMode,
	Environment,
	Executor,
	OutputFormat,
	ReporterKit,
	ResolvedReporterConfig,
	Transport,
} from "vitest-agent-sdk";
import { osc8 } from "vitest-agent-sdk";

export interface BuildReporterKitInput {
	readonly env: Environment;
	readonly executor: Executor;
	readonly format: OutputFormat;
	readonly detail: ResolvedReporterConfig["detail"];
	readonly noColor: boolean;
	readonly consoleMode: ConsoleMode;
	readonly mcp: boolean;
	/**
	 * Resolved by the plugin from the detected environment plus the
	 * console matrix (true under `ci-github` when the resolved ci slot
	 * is not silent). Passed through verbatim onto `ResolvedReporterConfig`
	 * so custom reporters and the default GFM emitter see a stable value
	 * even when the reporter is constructed directly without the plugin.
	 */
	readonly githubActions: boolean;
	readonly dbPath?: string;
	readonly projectFilter?: string;
	readonly runCommand?: string;
	readonly coverageThresholds?: ResolvedReporterConfig["coverageThresholds"];
	readonly coverageTargets?: ResolvedReporterConfig["coverageTargets"];
	readonly coverageMode: ResolvedReporterConfig["coverageMode"];
	readonly transport: Transport;
	/**
	 * Project-level `test.passWithNoTests` value captured from the
	 * resolved Vitest config. Threaded onto {@link ResolvedReporterConfig}
	 * for consumer reporters / UIs that want to render the resolved
	 * policy. The MCP `run_tests` tool does not read this snapshot — see
	 * the field docstring on `ResolvedReporterConfig` for the full note.
	 */
	readonly passWithNoTests?: boolean;
}

export const buildReporterKit = (input: BuildReporterKitInput): ReporterKit => {
	// Renderer-internal defaults derived from the resolved console mode + env.
	// These were user options pre-2.0; in 2.0 the surface shrinks to the five
	// public fields and these become kit-internal constants or env-derived
	// values. Custom reporters that need different behavior receive the
	// resolved values via ResolvedReporterConfig and can branch as needed.
	const consoleOutput: "failures" | "full" | "silent" = input.consoleMode === "silent" ? "silent" : "failures";
	const githubSummary = input.githubActions;
	const githubSummaryFile = process.env.GITHUB_STEP_SUMMARY;

	const config: ResolvedReporterConfig = {
		executor: input.executor,
		consoleMode: input.consoleMode,
		mcp: input.mcp,
		consoleOutput,
		omitPassingTests: true,
		coverageConsoleLimit: 10,
		includeBareZero: false,
		githubActions: input.githubActions,
		githubSummary,
		format: input.format,
		detail: input.detail,
		noColor: input.noColor,
		coverageMode: input.coverageMode,
		transport: input.transport,
		...(input.dbPath !== undefined && { dbPath: input.dbPath }),
		...(input.projectFilter !== undefined && { projectFilter: input.projectFilter }),
		...(githubSummaryFile !== undefined && { githubSummaryFile }),
		...(input.runCommand !== undefined && { runCommand: input.runCommand }),
		...(input.coverageThresholds !== undefined && { coverageThresholds: input.coverageThresholds }),
		...(input.coverageTargets !== undefined && { coverageTargets: input.coverageTargets }),
		...(input.passWithNoTests !== undefined && { passWithNoTests: input.passWithNoTests }),
	};

	// OSC-8 is enabled when running interactively (terminal/agent-shell) and
	// the user hasn't opted out via NO_COLOR. CI environments never see
	// hyperlinks because their terminals usually don't render them and the
	// noise pollutes log files.
	const osc8Enabled = !input.noColor && (input.env === "terminal" || input.env === "agent-shell");

	return {
		config,
		stdEnv: input.env,
		stdOsc8: (url: string, label: string) => osc8(url, label, { enabled: osc8Enabled }),
	};
};

/**
 * Normalize the result of {@link VitestAgentReporterFactory} to an array.
 * The factory contract allows returning either a single reporter or an
 * array of reporters; the plugin always works with the array form.
 */
export const normalizeReporters = <T>(result: T | ReadonlyArray<T>): ReadonlyArray<T> => {
	return Array.isArray(result) ? result : [result as T];
};
