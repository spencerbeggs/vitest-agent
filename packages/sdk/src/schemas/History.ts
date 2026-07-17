import { Schema } from "effect";

/**
 * A single test run outcome (pass or fail only).
 * @public
 */
export const TestRun = Schema.Struct({
	timestamp: Schema.String,
	state: Schema.Literals(["passed", "failed"]),
}).annotate({ identifier: "TestRun" });
/** @public */
export type TestRun = typeof TestRun.Type;

/**
 * History for a single test across multiple runs.
 * @public
 */
export const TestHistory = Schema.Struct({
	modulePath: Schema.String,
	fullName: Schema.String,
	runs: Schema.Array(TestRun),
}).annotate({ identifier: "TestHistory" });
/** @public */
export type TestHistory = typeof TestHistory.Type;

/**
 * Per-project history record containing all tracked tests.
 * @public
 */
export const HistoryRecord = Schema.Struct({
	project: Schema.String,
	updatedAt: Schema.String,
	tests: Schema.Array(TestHistory),
}).annotate({ identifier: "HistoryRecord" });
/** @public */
export type HistoryRecord = typeof HistoryRecord.Type;
