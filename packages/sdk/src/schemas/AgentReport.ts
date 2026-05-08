/**
 * AgentReport and related schemas.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { ReportError, TestClassification, TestRunReason, TestState } from "./Common.js";
import { CoverageReport } from "./Coverage.js";

/**
 * Aggregate test run statistics.
 */
export const ReportSummary = Schema.Struct({
	total: Schema.Number,
	passed: Schema.Number,
	failed: Schema.Number,
	skipped: Schema.Number,
	duration: Schema.Number,
}).annotations({ identifier: "ReportSummary" });
export type ReportSummary = typeof ReportSummary.Type;

/**
 * An individual test case result.
 */
export const TestReport = Schema.Struct({
	name: Schema.String,
	fullName: Schema.String,
	state: TestState,
	duration: Schema.optional(Schema.Number),
	flaky: Schema.optional(Schema.Boolean),
	slow: Schema.optional(Schema.Boolean),
	errors: Schema.optional(Schema.Array(ReportError)),
	classification: Schema.optional(TestClassification),
}).annotations({ identifier: "TestReport" });
export type TestReport = typeof TestReport.Type;

/**
 * A test module (file) and its contained test cases.
 */
export const ModuleReport = Schema.Struct({
	file: Schema.String,
	state: TestState,
	duration: Schema.optional(Schema.Number),
	errors: Schema.optional(Schema.Array(ReportError)),
	tests: Schema.Array(TestReport),
}).annotations({ identifier: "ModuleReport" });
export type ModuleReport = typeof ModuleReport.Type;

/**
 * Per-tag pass/fail/skip aggregates for a single project run.
 */
export const TagCountEntry = Schema.Struct({
	passed: Schema.optional(Schema.Number),
	failed: Schema.optional(Schema.Number),
	skipped: Schema.optional(Schema.Number),
}).annotations({ identifier: "TagCountEntry" });
export type TagCountEntry = typeof TagCountEntry.Type;

/**
 * Complete per-project test report written to disk as JSON.
 */
export const AgentReport = Schema.Struct({
	timestamp: Schema.String,
	project: Schema.optional(Schema.String),
	reason: TestRunReason,
	summary: ReportSummary,
	failed: Schema.Array(ModuleReport),
	unhandledErrors: Schema.Array(ReportError),
	failedFiles: Schema.Array(Schema.String),
	coverage: Schema.optional(CoverageReport),
	tagCounts: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: TagCountEntry,
		}),
	),
}).annotations({ identifier: "AgentReport" });
export type AgentReport = typeof AgentReport.Type;
