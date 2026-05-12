/**
 * Denormalized projection of a {@link RunEvent} stream — the shape both
 * the Ink human-mode renderer and the agent-mode string renderer consume.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { ReportError, TestClassification, TestState } from "./Common.js";
import { CoverageTotals } from "./Coverage.js";
import { ActionSeverity, CoverageGap, CoverageMetric } from "./RunEvent.js";
import { MetricThresholds } from "./Thresholds.js";

/**
 * Per-test record accumulated as `TestStarted` / `TestFinished` events arrive.
 */
export const TestRecord = Schema.Struct({
	testName: Schema.String,
	suitePath: Schema.Array(Schema.String),
	status: Schema.Union(TestState, Schema.Literal("running")),
	durationMs: Schema.NullOr(Schema.Number),
	error: Schema.optional(ReportError),
}).annotations({ identifier: "TestRecord" });
export type TestRecord = typeof TestRecord.Type;

/**
 * Per-module aggregation. The reducer keeps modules keyed on
 * `modulePath` so out-of-order events can update the right slot.
 */
export const ModuleRecord = Schema.Struct({
	modulePath: Schema.String,
	status: Schema.Literal("queued", "running", "finished"),
	passCount: Schema.Number,
	failCount: Schema.Number,
	skipCount: Schema.Number,
	durationMs: Schema.Number,
	tests: Schema.Array(TestRecord),
}).annotations({ identifier: "ModuleRecord" });
export type ModuleRecord = typeof ModuleRecord.Type;

/**
 * One row in the failure list. A failure can exist before its
 * classification arrives (`FailureClassified` is emitted from a
 * separate pipeline), so `classification` is nullable.
 */
export const FailureRecord = Schema.Struct({
	modulePath: Schema.String,
	testName: Schema.String,
	suitePath: Schema.Array(Schema.String),
	error: Schema.optional(ReportError),
	classification: Schema.NullOr(TestClassification),
}).annotations({ identifier: "FailureRecord" });
export type FailureRecord = typeof FailureRecord.Type;

/**
 * Coverage block, populated only after `CoverageReady`. Threshold
 * violations are accumulated separately as they arrive.
 */
export const CoverageRenderState = Schema.Struct({
	metrics: CoverageTotals,
	thresholds: MetricThresholds,
	gaps: Schema.Array(CoverageGap),
	violations: Schema.Array(
		Schema.Struct({
			metric: CoverageMetric,
			expected: Schema.Number,
			actual: Schema.Number,
		}),
	),
}).annotations({ identifier: "CoverageRenderState" });
export type CoverageRenderState = typeof CoverageRenderState.Type;

/**
 * A `SuggestedAction` event, denormalized into the queue the renderer reads.
 */
export const SuggestedActionRecord = Schema.Struct({
	severity: ActionSeverity,
	title: Schema.String,
	detail: Schema.String,
	targetTool: Schema.optional(Schema.String),
}).annotations({ identifier: "SuggestedActionRecord" });
export type SuggestedActionRecord = typeof SuggestedActionRecord.Type;

/**
 * Per-run totals, recomputed on every `ModuleFinished` and reconciled
 * against `RunFinished` (which carries the runner's own count).
 */
export const RenderTotals = Schema.Struct({
	passCount: Schema.Number,
	failCount: Schema.Number,
	skipCount: Schema.Number,
	durationMs: Schema.Number,
}).annotations({ identifier: "RenderTotals" });
export type RenderTotals = typeof RenderTotals.Type;

/**
 * The renderer state. Both the human (Ink) and agent (string)
 * renderers read this shape; the reducer is the only producer.
 *
 * `phase` is the layout discriminator — agent mode emits one final
 * frame when `phase === "finished"`; human mode redraws at every
 * state change.
 */
export const RenderState = Schema.Struct({
	phase: Schema.Literal("idle", "running", "finished"),
	runId: Schema.NullOr(Schema.String),
	configHash: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	modules: Schema.Record({ key: Schema.String, value: ModuleRecord }),
	moduleOrder: Schema.Array(Schema.String),
	totals: RenderTotals,
	coverage: Schema.NullOr(CoverageRenderState),
	failures: Schema.Array(FailureRecord),
	suggestedActions: Schema.Array(SuggestedActionRecord),
}).annotations({ identifier: "RenderState" });
export type RenderState = typeof RenderState.Type;

/**
 * Initial state — what the reducer returns when no events have been
 * applied yet. Exported so tests and the renderers' bootstrapping
 * code share one definition.
 */
export const initialRenderState: RenderState = {
	phase: "idle",
	runId: null,
	configHash: null,
	startedAt: null,
	finishedAt: null,
	modules: {},
	moduleOrder: [],
	totals: { passCount: 0, failCount: 0, skipCount: 0, durationMs: 0 },
	coverage: null,
	failures: [],
	suggestedActions: [],
};
