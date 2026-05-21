/**
 * Common schemas shared across multiple modules.
 *
 * Defines enums/literals and the ReportError struct used by
 * both AgentReport and CacheManifest schemas.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

// --- Shared Enums ---

/**
 * Possible states for an individual test case.
 */
export const TestState = Schema.Literal("passed", "failed", "skipped", "pending").annotations({
	identifier: "TestState",
});
export type TestState = typeof TestState.Type;

/**
 * Overall outcome of a test run.
 */
export const TestRunReason = Schema.Literal("passed", "failed", "interrupted").annotations({
	identifier: "TestRunReason",
});
export type TestRunReason = typeof TestRunReason.Type;

/**
 * Classification of a test's failure history across runs.
 */
export const TestClassification = Schema.Literal(
	"stable",
	"new-failure",
	"persistent",
	"flaky",
	"recovered",
).annotations({ identifier: "TestClassification" });
export type TestClassification = typeof TestClassification.Type;

/**
 * Console output verbosity mode for AgentReporter.
 */
export const ConsoleOutputMode = Schema.Literal("failures", "full", "silent").annotations({
	identifier: "ConsoleOutputMode",
});
export type ConsoleOutputMode = typeof ConsoleOutputMode.Type;

/**
 * Console output choices per executor type.
 *
 * - `passthrough` — plugin emits nothing observable; Vitest's own reporters
 *   do the visible work. Persistence still runs. Default for `human` and `ci`.
 * - `silent` — strip Vitest's reporters AND emit nothing from the plugin.
 *   True silence. Persistence still runs.
 * - `agent` — markdown-flavored final-frame string tuned for token economy.
 *   Default for `agent` executor. Set on `human` as the debugging mode for
 *   inspecting the exact plain-text output an agent consumes.
 * - `stream` — progressively-drawn, colored, animated rendering of the
 *   agent's run-shape view. Strips Vitest's reporters and owns stdout for
 *   the duration of the run. Human executor only.
 * - `ci-annotations` — GitHub Actions `::error::` annotations. Opt-in for
 *   the `ci` executor; the matching dedicated emitter is not yet shipped,
 *   so the default for `ci` is `passthrough` until it lands.
 */
export const HumanConsoleMode = Schema.Literal("passthrough", "silent", "stream", "agent").annotations({
	identifier: "HumanConsoleMode",
});
export type HumanConsoleMode = typeof HumanConsoleMode.Type;

export const AgentConsoleMode = Schema.Literal("passthrough", "silent", "agent").annotations({
	identifier: "AgentConsoleMode",
});
export type AgentConsoleMode = typeof AgentConsoleMode.Type;

export const CiConsoleMode = Schema.Literal("passthrough", "silent", "ci-annotations").annotations({
	identifier: "CiConsoleMode",
});
export type CiConsoleMode = typeof CiConsoleMode.Type;

/**
 * Union of every legal console-output value across the three executor slots.
 * Useful for type-narrowing in renderers that take the resolved value.
 */
export const ConsoleMode = Schema.Union(HumanConsoleMode, AgentConsoleMode, CiConsoleMode).annotations({
	identifier: "ConsoleMode",
});
export type ConsoleMode = typeof ConsoleMode.Type;

/**
 * Supported package managers for run command generation.
 */
export const PackageManager = Schema.Literal("pnpm", "npm", "yarn", "bun").annotations({
	identifier: "PackageManager",
});
export type PackageManager = typeof PackageManager.Type;

/**
 * Runtime environment where tests are being executed.
 */
export const Environment = Schema.Literal("agent-shell", "terminal", "ci-github", "ci-generic").annotations({
	identifier: "Environment",
});
export type Environment = typeof Environment.Type;

/**
 * Who or what is executing the test run.
 */
export const Executor = Schema.Literal("human", "agent", "ci").annotations({
	identifier: "Executor",
});
export type Executor = typeof Executor.Type;

/**
 * Output format for the reporter pipeline.
 */
export const OutputFormat = Schema.Literal(
	"terminal",
	"markdown",
	"json",
	"vitest-bypass",
	"silent",
	"ci-annotations",
).annotations({
	identifier: "OutputFormat",
});
export type OutputFormat = typeof OutputFormat.Type;

/**
 * Level of detail in reporter output.
 */
export const DetailLevel = Schema.Literal("minimal", "neutral", "standard", "verbose").annotations({
	identifier: "DetailLevel",
});
export type DetailLevel = typeof DetailLevel.Type;

// --- Report Error ---

/**
 * A single test or module error with optional stack trace, diff, and
 * structured assertion values.
 *
 * `expected` / `received` are pre-stringified, one-line representations
 * of the assertion's expected and received JS values. They are populated
 * only when the underlying test runner error carries structured `.expected`
 * / `.actual` properties (assertion errors). The raw JS values stay in
 * Vitest's internal error object; only the string representation crosses
 * the schema boundary.
 */
export const ReportError = Schema.Struct({
	message: Schema.String,
	stack: Schema.optional(Schema.String),
	diff: Schema.optional(Schema.String),
	expected: Schema.optional(Schema.String),
	received: Schema.optional(Schema.String),
}).annotations({ identifier: "ReportError" });
export type ReportError = typeof ReportError.Type;
