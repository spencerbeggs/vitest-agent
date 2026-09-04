import { Effect, Schema } from "effect";
import { MetricThresholds, PatternThresholds } from "./Thresholds.js";

/**
 * Aggregate coverage percentages across four istanbul metrics.
 * @public
 */
export const CoverageTotals = Schema.Struct({
	statements: Schema.Number,
	branches: Schema.Number,
	functions: Schema.Number,
	lines: Schema.Number,
}).annotate({ identifier: "CoverageTotals" });
/** @public */
export type CoverageTotals = typeof CoverageTotals.Type;

/**
 * Per-file coverage data including uncovered line ranges.
 * @public
 */
export const FileCoverageReport = Schema.Struct({
	file: Schema.String,
	summary: CoverageTotals,
	uncoveredLines: Schema.String,
}).annotate({ identifier: "FileCoverageReport" });
/** @public */
export type FileCoverageReport = typeof FileCoverageReport.Type;

/**
 * Complete coverage report attached to an AgentReport.
 * @public
 */
export const CoverageReport = Schema.Struct({
	totals: CoverageTotals,
	thresholds: Schema.Struct({
		global: MetricThresholds,
		patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	}),
	targets: Schema.optional(
		Schema.Struct({
			global: MetricThresholds,
			patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		}),
	),
	baselines: Schema.optional(
		Schema.Struct({
			global: MetricThresholds,
			patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		}),
	),
	scoped: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	scopedFiles: Schema.optional(Schema.Array(Schema.String)),
	// Issue #160 gap 1: total test-file count for the project, known only
	// when the caller supplies it (the reporter has it via a fresh
	// `globTestSpecifications()` count; nothing else in this report can
	// derive it). Lets the scoped-coverage note render "N of M" instead of
	// just "N" test files.
	totalFiles: Schema.optional(Schema.Number),
	lowCoverage: Schema.Array(FileCoverageReport),
	lowCoverageFiles: Schema.Array(Schema.String),
	belowTarget: Schema.optional(Schema.Array(FileCoverageReport)),
	belowTargetFiles: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "CoverageReport" });
/** @public */
export type CoverageReport = typeof CoverageReport.Type;
