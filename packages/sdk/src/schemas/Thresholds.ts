import { Schema } from "effect";

/**
 * Per-metric threshold values. All optional -- only set metrics are enforced.
 * @public
 */
export const MetricThresholds = Schema.Struct({
	lines: Schema.optional(Schema.Number),
	functions: Schema.optional(Schema.Number),
	branches: Schema.optional(Schema.Number),
	statements: Schema.optional(Schema.Number),
}).annotations({ identifier: "MetricThresholds" });
/** @public */
export type MetricThresholds = typeof MetricThresholds.Type;

/**
 * A glob pattern paired with its metric thresholds.
 * @public
 */
export const PatternThresholds = Schema.Tuple(Schema.String, MetricThresholds).annotations({
	identifier: "PatternThresholds",
});
/** @public */
export type PatternThresholds = typeof PatternThresholds.Type;

/**
 * Fully resolved thresholds ready for evaluation.
 * @public
 */
export const ResolvedThresholds = Schema.Struct({
	global: MetricThresholds,
	perFile: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	patterns: Schema.optionalWith(Schema.Array(PatternThresholds), {
		default: () => [],
	}),
}).annotations({ identifier: "ResolvedThresholds" });
/** @public */
export type ResolvedThresholds = typeof ResolvedThresholds.Type;
