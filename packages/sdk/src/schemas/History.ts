import { Schema } from "effect";

/**
 * A single test run outcome (pass or fail only).
 * @public
 */
export const TestRun = Schema.Struct({
	timestamp: Schema.String,
	state: Schema.Literal("passed", "failed"),
}).annotations({ identifier: "TestRun" });
/** @public */
export type TestRun = typeof TestRun.Type;

/**
 * History for a single test across multiple runs.
 * @public
 */
export const TestHistory = Schema.Struct({
	fullName: Schema.String,
	runs: Schema.Array(TestRun),
}).annotations({ identifier: "TestHistory" });
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
}).annotations({ identifier: "HistoryRecord" });
/** @public */
export type HistoryRecord = typeof HistoryRecord.Type;
