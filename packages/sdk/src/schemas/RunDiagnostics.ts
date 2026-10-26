import { Schema } from "effect";
import { FiniteNumber } from "./Common.js";

/**
 * Which Vitest performance diagnostic a hint came from.
 * @public
 */
export const PerformanceHintKind = Schema.Literals(["environment", "import", "transform", "isolate"]).annotate({
	identifier: "PerformanceHintKind",
});
/** @public */
export type PerformanceHintKind = typeof PerformanceHintKind.Type;

/**
 * One performance hint derived from Vitest's run diagnostics. `project` is
 * omitted for a hint that applies to the whole run (for example `isolate`).
 * @public
 */
export const PerformanceHint = Schema.Struct({
	kind: PerformanceHintKind,
	project: Schema.optionalKey(Schema.String),
	message: Schema.String,
	remedy: Schema.String,
	detail: Schema.String,
	learnMoreUrl: Schema.String,
	estimatedSavingMs: Schema.optionalKey(FiniteNumber),
	share: Schema.optionalKey(FiniteNumber),
}).annotate({ identifier: "PerformanceHint" });
/** @public */
export type PerformanceHint = typeof PerformanceHint.Type;

/**
 * Wall-clock timing of the plugin's post-run work, in milliseconds.
 * @public
 */
export const PostRunTiming = Schema.Struct({
	persistMs: FiniteNumber,
	coverageScanMs: FiniteNumber,
	totalMs: FiniteNumber,
	renderMs: Schema.optionalKey(FiniteNumber),
	vitestDurationMs: Schema.optionalKey(FiniteNumber),
}).annotate({ identifier: "PostRunTiming" });
/** @public */
export type PostRunTiming = typeof PostRunTiming.Type;

/**
 * Whether the run's results were persisted to the database.
 * @public
 */
export const PersistenceStatus = Schema.Struct({
	ok: Schema.Boolean,
	reason: Schema.optionalKey(Schema.String),
	migrationFailed: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "PersistenceStatus" });
/** @public */
export type PersistenceStatus = typeof PersistenceStatus.Type;

/**
 * Run-level diagnostics: performance hints, post-run timing and persistence
 * status (issue #544).
 * @public
 */
export const RunDiagnostics = Schema.Struct({
	performanceHints: Schema.Array(PerformanceHint),
	postRun: Schema.optionalKey(PostRunTiming),
	persistence: Schema.optionalKey(PersistenceStatus),
}).annotate({ identifier: "RunDiagnostics" });
/** @public */
export type RunDiagnostics = typeof RunDiagnostics.Type;
