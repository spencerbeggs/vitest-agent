/**
 * Configuration option schemas for AgentReporter and AgentPlugin.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import {
	AgentConsoleMode,
	CiConsoleMode,
	ConsoleMode,
	ConsoleOutputMode,
	DetailLevel,
	HumanConsoleMode,
	OutputFormat,
} from "./Common.js";

/**
 * Per-executor console-output matrix. Most users never set this — the
 * built-in defaults cover the common cases. Override per slot when you
 * want to force a specific layout for debugging or to suppress one
 * channel without affecting the others.
 *
 * Defaults:
 * - `human` → `"passthrough"` today; users opt into `"ink"` explicitly
 *   alongside wiring `createLiveInk` via `onRunEvent`.
 * - `agent` → `"agent"` (markdown-flavored final frame).
 * - `ci` → `"passthrough"` (Vitest's reporters produce log-friendly
 *   output). `"ci-annotations"` is opt-in until the dedicated GHA
 *   annotations writer ships.
 */
export const ConsoleOutputs = Schema.Struct({
	human: Schema.optional(HumanConsoleMode),
	agent: Schema.optional(AgentConsoleMode),
	ci: Schema.optional(CiConsoleMode),
}).annotations({ identifier: "ConsoleOutputs" });
export type ConsoleOutputs = typeof ConsoleOutputs.Type;

/**
 * Configuration options for AgentReporter.
 */
export const AgentReporterOptions = Schema.Struct({
	cacheDir: Schema.optional(Schema.String),
	consoleOutput: Schema.optional(ConsoleOutputMode),
	omitPassingTests: Schema.optional(Schema.Boolean),
	coverageThresholds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	coverageTargets: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	autoUpdate: Schema.optional(Schema.Boolean),
	coverageConsoleLimit: Schema.optional(Schema.Number),
	includeBareZero: Schema.optional(Schema.Boolean),
	githubActions: Schema.optional(Schema.Boolean),
	githubSummary: Schema.optional(Schema.Boolean),
	githubSummaryFile: Schema.optional(Schema.String),
	format: Schema.optional(OutputFormat),
	detail: Schema.optional(DetailLevel),
	consoleMode: Schema.optional(ConsoleMode),
	logLevel: Schema.optional(Schema.String),
	logFile: Schema.optional(Schema.String),
	mcp: Schema.optional(Schema.Boolean),
	projectFilter: Schema.optional(Schema.String),
}).annotations({ identifier: "AgentReporterOptions" });
export type AgentReporterOptions = typeof AgentReporterOptions.Type;

/**
 * Configuration options for AgentPlugin.
 *
 * The plugin manages `consoleOutput` automatically — users control
 * visible output via {@link ConsoleOutputs}.
 */
export const AgentPluginOptions = Schema.Struct({
	console: Schema.optional(ConsoleOutputs),
	githubSummary: Schema.optional(Schema.Boolean),
	format: Schema.optional(OutputFormat),
	logLevel: Schema.optional(Schema.String),
	logFile: Schema.optional(Schema.String),
	mcp: Schema.optional(Schema.Boolean),
	coverageThresholds: Schema.optional(Schema.Unknown),
	coverageTargets: Schema.optional(Schema.Unknown),
	reporterOptions: Schema.optional(
		Schema.Struct({
			cacheDir: Schema.optional(Schema.String),
			omitPassingTests: Schema.optional(Schema.Boolean),
			autoUpdate: Schema.optional(Schema.Boolean),
			coverageConsoleLimit: Schema.optional(Schema.Number),
			includeBareZero: Schema.optional(Schema.Boolean),
			githubSummaryFile: Schema.optional(Schema.String),
		}),
	),
}).annotations({ identifier: "AgentPluginOptions" });

export type AgentPluginOptions = typeof AgentPluginOptions.Type;

/**
 * Extracted coverage options for service use.
 */
export const CoverageOptions = Schema.Struct({
	thresholds: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	includeBareZero: Schema.Boolean,
	coverageConsoleLimit: Schema.Number,
}).annotations({ identifier: "CoverageOptions" });
export type CoverageOptions = typeof CoverageOptions.Type;

/**
 * Options for the console formatter.
 */
export const FormatterOptions = Schema.Struct({
	consoleOutput: ConsoleOutputMode,
	coverageConsoleLimit: Schema.Number,
	noColor: Schema.Boolean,
	cacheFile: Schema.String,
}).annotations({ identifier: "FormatterOptions" });
export type FormatterOptions = typeof FormatterOptions.Type;
