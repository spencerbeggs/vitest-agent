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
 * Aggregate stray-console-output signal for a single test run. Omitted from
 * a report entirely when the run produced no user console output.
 * @public
 */
export const ConsoleLeaks = Schema.Struct({
	total: Schema.Number,
	byFile: Schema.Array(ConsoleLeakFile),
	truncated: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ConsoleLeaks" });
/** @public */
export type ConsoleLeaks = typeof ConsoleLeaks.Type;
