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
	lowCoverage: Schema.Array(FileCoverageReport),
	lowCoverageFiles: Schema.Array(Schema.String),
	belowTarget: Schema.optional(Schema.Array(FileCoverageReport)),
	belowTargetFiles: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "CoverageReport" });
/** @public */
export type CoverageReport = typeof CoverageReport.Type;
