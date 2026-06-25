import { Schema } from "effect";
import { ReportError, TestClassification, TestState } from "./Common.js";
import { CoverageTotals } from "./Coverage.js";
import { ActionSeverity, CoverageGap, CoverageMetric } from "./RunEvent.js";
import { MetricThresholds } from "./Thresholds.js";

/**
 * Per-test record accumulated as `TestStarted` / `TestFinished` events arrive.
 * @public
 */
export const TestRecord = Schema.Struct({
	testName: Schema.String,
	suitePath: Schema.Array(Schema.String),
	status: Schema.Union(TestState, Schema.Literal("running", "timed-out")),
	durationMs: Schema.NullOr(Schema.Number),
	error: Schema.optional(ReportError),
}).annotations({ identifier: "TestRecord" });
/** @public */
export type TestRecord = typeof TestRecord.Type;

/**
 * Per-module aggregation. The reducer keeps modules keyed on
 * `modulePath` so out-of-order events can update the right slot.
 * @public
 */
export const ModuleRecord = Schema.Struct({
	modulePath: Schema.String,
	status: Schema.Literal("queued", "running", "finished"),
	passCount: Schema.Number,
	failCount: Schema.Number,
	skipCount: Schema.Number,
	timeoutCount: Schema.Number,
	durationMs: Schema.Number,
	tests: Schema.Array(TestRecord),
	/**
	 * Owning Vitest project name. Optional — events from project-less
	 * configs or older replays leave it `undefined`, which the renderer
	 * treats as a single anonymous project.
	 */
	projectName: Schema.optional(Schema.String),
	/**
	 * ISO wall-clock stamp captured at `onTestModuleStart`. The live
	 * renderer derives a ticking elapsed column from it while the module
	 * runs; once finished it shows `durationMs` instead. Optional — a
	 * module seeded by `ModuleQueued` (or replayed) has no start stamp.
	 */
	startedAt: Schema.optional(Schema.String),
	tagCounts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Number })),
}).annotations({ identifier: "ModuleRecord" });
/** @public */
export type ModuleRecord = typeof ModuleRecord.Type;

/**
 * One row in the failure list. A failure can exist before its
 * classification arrives (`FailureClassified` is emitted from a
 * separate pipeline), so `classification` is nullable.
 * @public
 */
export const FailureRecord = Schema.Struct({
	modulePath: Schema.String,
	testName: Schema.String,
	suitePath: Schema.Array(Schema.String),
	error: Schema.optional(ReportError),
	timedOut: Schema.optional(Schema.Boolean),
	classification: Schema.NullOr(TestClassification),
}).annotations({ identifier: "FailureRecord" });
/** @public */
export type FailureRecord = typeof FailureRecord.Type;

/**
 * Coverage block, populated only after `CoverageReady`. Threshold
 * violations are accumulated separately as they arrive.
 * @public
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
/** @public */
export type CoverageRenderState = typeof CoverageRenderState.Type;

/**
 * A `SuggestedAction` event, denormalized into the queue the renderer reads.
 * @public
 */
export const SuggestedActionRecord = Schema.Struct({
	severity: ActionSeverity,
	title: Schema.String,
	detail: Schema.String,
	targetTool: Schema.optional(Schema.String),
}).annotations({ identifier: "SuggestedActionRecord" });
/** @public */
export type SuggestedActionRecord = typeof SuggestedActionRecord.Type;

/**
 * Per-run totals, recomputed on every `ModuleFinished` and reconciled
 * against `RunFinished` (which carries the runner's own count).
 * @public
 */
export const RenderTotals = Schema.Struct({
	passCount: Schema.Number,
	failCount: Schema.Number,
	skipCount: Schema.Number,
	timeoutCount: Schema.Number,
	durationMs: Schema.Number,
}).annotations({ identifier: "RenderTotals" });
/** @public */
export type RenderTotals = typeof RenderTotals.Type;

/**
 * The renderer state. Both the human (Ink) and agent (string)
 * renderers read this shape; the reducer is the only producer.
 *
 * `phase` is the layout discriminator — agent mode emits one final
 * frame when `phase === "finished"`; human mode redraws at every
 * state change. `"timed-out"` is a terminal phase like `"finished"`
 * — the run is over, but it ended because `onProcessTimeout` fired
 * rather than the suite completing.
 * @public
 */
export const RenderState = Schema.Struct({
	phase: Schema.Literal("idle", "running", "finished", "timed-out"),
	runId: Schema.NullOr(Schema.String),
	configHash: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	modules: Schema.Record({ key: Schema.String, value: ModuleRecord }),
	moduleOrder: Schema.Array(Schema.String),
	totals: RenderTotals,
	coverage: Schema.NullOr(CoverageRenderState),
	trend: Schema.NullOr(
		Schema.Struct({
			direction: Schema.Literal("improving", "regressing", "stable"),
			runCount: Schema.Number,
		}),
	),
	failures: Schema.Array(FailureRecord),
	suggestedActions: Schema.Array(SuggestedActionRecord),
}).annotations({ identifier: "RenderState" });
/** @public */
export type RenderState = typeof RenderState.Type;

/**
 * Initial state — what the reducer returns when no events have been
 * applied yet. Exported so tests and the renderers' bootstrapping
 * code share one definition.
 * @public
 */
export const initialRenderState: RenderState = {
	phase: "idle",
	runId: null,
	configHash: null,
	startedAt: null,
	finishedAt: null,
	modules: {},
	moduleOrder: [],
	totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 0 },
	coverage: null,
	trend: null,
	failures: [],
	suggestedActions: [],
};
