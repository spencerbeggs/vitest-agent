import { Schema } from "effect";
import { CoverageTotals } from "./Coverage.js";

/**
 * A single coverage trend data point recorded on a full test run.
 * @public
 */
export const TrendEntry = Schema.Struct({
	timestamp: Schema.String,
	coverage: CoverageTotals,
	delta: CoverageTotals,
	direction: Schema.Literal("improving", "regressing", "stable"),
	targetsHash: Schema.optional(Schema.String),
}).annotations({ identifier: "TrendEntry" });
/** @public */
export type TrendEntry = typeof TrendEntry.Type;

/**
 * Per-project trend record with sliding window of entries.
 * @public
 */
export const TrendRecord = Schema.Struct({
	entries: Schema.Array(TrendEntry),
}).annotations({ identifier: "TrendRecord" });
/** @public */
export type TrendRecord = typeof TrendRecord.Type;
