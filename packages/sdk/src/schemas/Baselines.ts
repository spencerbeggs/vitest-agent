import { Effect, Schema } from "effect";
import { MetricThresholds, PatternThresholds } from "./Thresholds.js";

/**
 * Coverage baselines -- the auto-ratcheting high-water mark.
 * @public
 */
export const CoverageBaselines = Schema.Struct({
	updatedAt: Schema.String,
	global: MetricThresholds,
	patterns: Schema.Array(PatternThresholds).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}).annotate({ identifier: "CoverageBaselines" });
/** @public */
export type CoverageBaselines = typeof CoverageBaselines.Type;
