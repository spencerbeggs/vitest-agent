/**
 * Common schemas shared across multiple modules.
 *
 * Defines enums/literals and the ReportError struct used by
 * both AgentReport and CacheManifest schemas.
 */
import { Schema } from "effect";

// --- Shared Enums ---

/**
 * Possible states for an individual test case.
 * @public
 */
export const TestState = Schema.Literals(["passed", "failed", "skipped", "pending"]).annotate({
	identifier: "TestState",
});
/** @public */
export type TestState = typeof TestState.Type;

/**
 * Overall outcome of a test run.
 * @public
 */
export const TestRunReason = Schema.Literals(["passed", "failed", "interrupted"]).annotate({
	identifier: "TestRunReason",
});
/** @public */
export type TestRunReason = typeof TestRunReason.Type;

/**
 * Classification of a test's failure history across runs.
 * @public
 */
export const TestClassification = Schema.Literals([
	"stable",
	"new-failure",
	"persistent",
	"flaky",
	"recovered",
]).annotate({ identifier: "TestClassification" });
/** @public */
export type TestClassification = typeof TestClassification.Type;

/**
 * Console output verbosity mode for AgentReporter.
 * @public
 */
export const ConsoleOutputMode = Schema.Literals(["failures", "full", "silent"]).annotate({
	identifier: "ConsoleOutputMode",
});
/** @public */
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
 * @public
 */
export const HumanConsoleMode = Schema.Literals(["passthrough", "silent", "stream", "agent"]).annotate({
	identifier: "HumanConsoleMode",
});
/** @public */
export type HumanConsoleMode = typeof HumanConsoleMode.Type;

/** @public */
export const AgentConsoleMode = Schema.Literals(["passthrough", "silent", "agent"]).annotate({
	identifier: "AgentConsoleMode",
});
/** @public */
export type AgentConsoleMode = typeof AgentConsoleMode.Type;

/** @public */
export const CiConsoleMode = Schema.Literals(["passthrough", "silent", "ci-annotations"]).annotate({
	identifier: "CiConsoleMode",
});
/** @public */
export type CiConsoleMode = typeof CiConsoleMode.Type;

/**
 * Union of every legal console-output value across the three executor slots.
 * Useful for type-narrowing in renderers that take the resolved value.
 * @public
 */
export const ConsoleMode = Schema.Union([HumanConsoleMode, AgentConsoleMode, CiConsoleMode]).annotate({
	identifier: "ConsoleMode",
});
/** @public */
export type ConsoleMode = typeof ConsoleMode.Type;

/**
 * Supported package managers for run command generation.
 * @public
 */
export const PackageManager = Schema.Literals(["pnpm", "npm", "yarn", "bun"]).annotate({
	identifier: "PackageManager",
});
/** @public */
export type PackageManager = typeof PackageManager.Type;

/**
 * Runtime environment where tests are being executed.
 * @public
 */
export const Environment = Schema.Literals(["agent-shell", "terminal", "ci-github", "ci-generic"]).annotate({
	identifier: "Environment",
});
/** @public */
export type Environment = typeof Environment.Type;

/**
 * Who or what is executing the test run.
 * @public
 */
export const Executor = Schema.Literals(["human", "agent", "ci"]).annotate({
	identifier: "Executor",
});
/** @public */
export type Executor = typeof Executor.Type;

/**
 * Output format for the reporter pipeline.
 * @public
 */
export const OutputFormat = Schema.Literals([
	"terminal",
	"markdown",
	"json",
	"vitest-bypass",
	"silent",
	"ci-annotations",
]).annotate({
	identifier: "OutputFormat",
});
/** @public */
export type OutputFormat = typeof OutputFormat.Type;

/**
 * Level of detail in reporter output.
 * @public
 */
export const DetailLevel = Schema.Literals(["minimal", "neutral", "standard", "verbose"]).annotate({
	identifier: "DetailLevel",
});
/** @public */
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
 * @public
 */
export const ReportError = Schema.Struct({
	message: Schema.String,
	stack: Schema.optional(Schema.String),
	diff: Schema.optional(Schema.String),
	expected: Schema.optional(Schema.String),
	received: Schema.optional(Schema.String),
}).annotate({ identifier: "ReportError" });
/** @public */
export type ReportError = typeof ReportError.Type;
