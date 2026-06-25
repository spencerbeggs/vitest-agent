import { Schema } from "effect";
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
}).annotations({ identifier: "CoverageTotals" });
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
}).annotations({ identifier: "FileCoverageReport" });
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
		patterns: Schema.optionalWith(Schema.Array(PatternThresholds), {
			default: () => [],
		}),
	}),
	targets: Schema.optional(
		Schema.Struct({
			global: MetricThresholds,
			patterns: Schema.optionalWith(Schema.Array(PatternThresholds), {
				default: () => [],
			}),
		}),
	),
	baselines: Schema.optional(
		Schema.Struct({
			global: MetricThresholds,
			patterns: Schema.optionalWith(Schema.Array(PatternThresholds), {
				default: () => [],
			}),
		}),
	),
	scoped: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	scopedFiles: Schema.optional(Schema.Array(Schema.String)),
	lowCoverage: Schema.Array(FileCoverageReport),
	lowCoverageFiles: Schema.Array(Schema.String),
	belowTarget: Schema.optional(Schema.Array(FileCoverageReport)),
	belowTargetFiles: Schema.optional(Schema.Array(Schema.String)),
}).annotations({ identifier: "CoverageReport" });
/** @public */
export type CoverageReport = typeof CoverageReport.Type;
