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
	readonly consoleOutput: "failures" | "full" | "silent";
	readonly omitPassingTests: boolean;
	readonly coverageConsoleLimit: number;
	readonly includeBareZero: boolean;
	readonly githubActions: boolean;
	readonly githubSummary: boolean;
	readonly dbPath?: string;
	readonly projectFilter?: string;
	readonly githubSummaryFile?: string;
	readonly runCommand?: string;
	readonly coverageThresholds?: ResolvedReporterConfig["coverageThresholds"];
	readonly coverageTargets?: ResolvedReporterConfig["coverageTargets"];
	readonly coverageMode: ResolvedReporterConfig["coverageMode"];
}

export const buildReporterKit = (input: BuildReporterKitInput): ReporterKit => {
	const config: ResolvedReporterConfig = {
		executor: input.executor,
		consoleMode: input.consoleMode,
		mcp: input.mcp,
		consoleOutput: input.consoleOutput,
		omitPassingTests: input.omitPassingTests,
		coverageConsoleLimit: input.coverageConsoleLimit,
		includeBareZero: input.includeBareZero,
		githubActions: input.githubActions,
		githubSummary: input.githubSummary,
		format: input.format,
		detail: input.detail,
		noColor: input.noColor,
		...(input.dbPath !== undefined && { dbPath: input.dbPath }),
		...(input.projectFilter !== undefined && { projectFilter: input.projectFilter }),
		...(input.githubSummaryFile !== undefined && { githubSummaryFile: input.githubSummaryFile }),
		...(input.runCommand !== undefined && { runCommand: input.runCommand }),
		...(input.coverageThresholds !== undefined && { coverageThresholds: input.coverageThresholds }),
		...(input.coverageTargets !== undefined && { coverageTargets: input.coverageTargets }),
		coverageMode: input.coverageMode,
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
