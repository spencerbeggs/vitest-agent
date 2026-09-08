import { Effect, Schema } from "effect";

/**
 * Per-metric threshold values. All optional -- only set metrics are enforced.
 * @public
 */
export const MetricThresholds = Schema.Struct({
	lines: Schema.optional(Schema.Number),
	functions: Schema.optional(Schema.Number),
	branches: Schema.optional(Schema.Number),
	statements: Schema.optional(Schema.Number),
}).annotate({ identifier: "MetricThresholds" });
/** @public */
export type MetricThresholds = typeof MetricThresholds.Type;

/**
 * A `perFile` setting. Vitest 5 allows either a plain boolean or a
 * per-metric object that overrides the metric numbers used for the
 * per-file check.
 *
 * An object constrains exactly the metrics it names, so `{}` enforces
 * nothing at all. Write `true` to check every metric.
 * @public
 */
export const PerFileThresholds = Schema.Union([Schema.Boolean, MetricThresholds]).annotate({
	identifier: "PerFileThresholds",
});
/** @public */
export type PerFileThresholds = typeof PerFileThresholds.Type;

/**
 * The metric values carried by a glob-pattern entry. Under Vitest 5 a
 * glob entry no longer inherits the top-level `perFile`, so it carries
 * its own optional setting.
 * @public
 */
export const PatternMetricThresholds = Schema.Struct({
	...MetricThresholds.fields,
	perFile: Schema.optionalKey(PerFileThresholds),
}).annotate({ identifier: "PatternMetricThresholds" });
/** @public */
export type PatternMetricThresholds = typeof PatternMetricThresholds.Type;

/**
 * A glob pattern paired with its metric thresholds.
 * @public
 */
export const PatternThresholds = Schema.Tuple([Schema.String, PatternMetricThresholds]).annotate({
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
	perFile: PerFileThresholds.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({ identifier: "ResolvedThresholds" });
/** @public */
export type ResolvedThresholds = typeof ResolvedThresholds.Type;
