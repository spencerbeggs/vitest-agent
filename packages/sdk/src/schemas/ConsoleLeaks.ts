import { Schema } from "effect";

/**
 * Per-file stray-console-output detail. Counts are of console writes
 * (one `console.*` call), not lines.
 * @public
 */
export const ConsoleLeakFile = Schema.Struct({
	file: Schema.String,
	stdout: Schema.Number,
	stderr: Schema.Number,
	tests: Schema.optional(Schema.Array(Schema.String)),
	sample: Schema.optional(Schema.String),
}).annotate({ identifier: "ConsoleLeakFile" });
/** @public */
export type ConsoleLeakFile = typeof ConsoleLeakFile.Type;

/**
 * Summary of console output logged inside tests that did NOT pass. Kept
 * separate from `total`/`byFile` so it can never be mistaken for a leak in a
 * passing test — assertion-failure logging that routes through `console.*`
 * (common with logger-backed assertion libraries) would otherwise camouflage
 * genuine leaks on every red run.
 * @public
 */
export const ConsoleLeaksFromFailingTests = Schema.Struct({
	total: Schema.Number,
	files: Schema.Number,
}).annotate({ identifier: "ConsoleLeaksFromFailingTests" });
/** @public */
export type ConsoleLeaksFromFailingTests = typeof ConsoleLeaksFromFailingTests.Type;

/**
 * Aggregate stray-console-output signal for a single test run. Omitted from
 * a report entirely when the run produced no user console output at all
 * (neither non-failing nor failing-test writes). `total`/`byFile` count only
 * output from tests that did not fail; `fromFailingTests`, when present,
 * summarizes the output Vitest captured from failing tests so it stays
 * visible without polluting the actionable leak signal (issue #263).
 * @public
 */
export const ConsoleLeaks = Schema.Struct({
	total: Schema.Number,
	byFile: Schema.Array(ConsoleLeakFile),
	truncated: Schema.optional(Schema.Boolean),
	fromFailingTests: Schema.optional(ConsoleLeaksFromFailingTests),
}).annotate({ identifier: "ConsoleLeaks" });
/** @public */
export type ConsoleLeaks = typeof ConsoleLeaks.Type;
