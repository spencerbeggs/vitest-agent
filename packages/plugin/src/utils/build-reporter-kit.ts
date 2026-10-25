/**
 * Assemble a `ReporterKit` from a fully-resolved reporter config.
 *
 * The plugin calls this once per run, after the data pipeline has resolved
 * `env` (via `EnvironmentDetector`), `executor` (via `ExecutorResolver`),
 * and `detail` (via `DetailResolver`). The
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
	ReporterKit,
	ResolvedReporterConfig,
	RunEvent,
	Transport,
} from "@vitest-agent/sdk";
import type { PubSub } from "effect";

export interface BuildReporterKitInput {
	readonly env: Environment;
	readonly executor: Executor;
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
	/**
	 * Whether the run is recorded in SQLite (issue #625) — the plugin's
	 * resolution of `AgentPlugin({ persist })` and `VITEST_AGENT_PERSIST`.
	 * Passed through verbatim onto `ResolvedReporterConfig`.
	 */
	readonly persist: boolean;
	readonly transport: Transport;
	/**
	 * Live run-event channel. The plugin owns the `PubSub` and publishes
	 * one `RunEvent` per Vitest streaming callback onto it; the kit
	 * carries it through to the reporter factory so a live-painting
	 * reporter can subscribe. Optional so a kit can be built without the
	 * channel in tests.
	 */
	readonly runEvents?: PubSub.PubSub<RunEvent>;
	/**
	 * Project-level `test.passWithNoTests` value captured from the
	 * resolved Vitest config. Threaded onto `ResolvedReporterConfig`
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
		detail: input.detail,
		noColor: input.noColor,
		coverageMode: input.coverageMode,
		persist: input.persist,
		transport: input.transport,
		...(input.dbPath !== undefined && { dbPath: input.dbPath }),
		...(input.projectFilter !== undefined && { projectFilter: input.projectFilter }),
		...(githubSummaryFile !== undefined && { githubSummaryFile }),
		...(input.runCommand !== undefined && { runCommand: input.runCommand }),
		...(input.coverageThresholds !== undefined && { coverageThresholds: input.coverageThresholds }),
		...(input.coverageTargets !== undefined && { coverageTargets: input.coverageTargets }),
		...(input.passWithNoTests !== undefined && { passWithNoTests: input.passWithNoTests }),
	};

	// File hyperlinks are not the kit's to decide: the reporter reads
	// `@effected/cli`'s `CliLinks` from its own environment (issue #541).
	return {
		config,
		stdEnv: input.env,
		...(input.runEvents !== undefined && { runEvents: input.runEvents }),
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
