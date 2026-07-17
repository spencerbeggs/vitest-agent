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
 * A glob pattern paired with its metric thresholds.
 * @public
 */
export const PatternThresholds = Schema.Tuple([Schema.String, MetricThresholds]).annotate({
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
	perFile: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({ identifier: "ResolvedThresholds" });
/** @public */
export type ResolvedThresholds = typeof ResolvedThresholds.Type;
