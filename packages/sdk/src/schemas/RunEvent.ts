/**
 * Run-event taxonomy for the shared event-sourced renderer.
 *
 * A `RunEvent` is every state-affecting thing that happens during a
 * test run. The plugin publishes events as Vitest reporter callbacks
 * fire; CLI commands construct synthetic event sequences from database
 * queries. Both feed the same reducer in `vitest-agent-ui`, which
 * projects the stream into a denormalized {@link RenderState}.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { ReportError, TestClassification, TestState } from "./Common.js";
import { CoverageTotals, FileCoverageReport } from "./Coverage.js";
import { MetricThresholds } from "./Thresholds.js";

// --- Helper shapes ---

/**
 * Coverage metric whose threshold can be violated independently.
 */
export const CoverageMetric = Schema.Literal("lines", "branches", "functions", "statements").annotations({
	identifier: "CoverageMetric",
});
export type CoverageMetric = typeof CoverageMetric.Type;

/**
 * Severity tier for a suggested action emitted during a run.
 */
export const ActionSeverity = Schema.Literal("info", "warn", "blocker").annotations({
	identifier: "ActionSeverity",
});
export type ActionSeverity = typeof ActionSeverity.Type;

/**
 * A coverage gap surfaced to the renderer — a per-file shortfall that
 * a renderer may want to call out individually.
 */
export const CoverageGap = Schema.Struct({
	file: Schema.String,
	missing: CoverageTotals,
	uncoveredLines: Schema.optional(Schema.String),
}).annotations({ identifier: "CoverageGap" });
export type CoverageGap = typeof CoverageGap.Type;

// --- Discriminated union ---

/**
 * The reducer projects this union into {@link RenderState}. Renderers
 * never read the raw event stream — they read the projected state.
 *
 * @remarks
 * Adding a variant here is one change in one place; the reducer's
 * exhaustive `Match.exhaustive` will surface any renderer that hasn't
 * been updated to consume the new state shape.
 */
export const RunEvent = Schema.Union(
	Schema.TaggedStruct("RunStarted", {
		runId: Schema.String,
		startedAt: Schema.String,
		configHash: Schema.String,
	}),
	Schema.TaggedStruct("ModuleQueued", {
		modulePath: Schema.String,
	}),
	Schema.TaggedStruct("ModuleStarted", {
		modulePath: Schema.String,
		startedAt: Schema.String,
	}),
	Schema.TaggedStruct("TestStarted", {
		modulePath: Schema.String,
		testName: Schema.String,
		suitePath: Schema.Array(Schema.String),
	}),
	Schema.TaggedStruct("TestFinished", {
		modulePath: Schema.String,
		testName: Schema.String,
		suitePath: Schema.Array(Schema.String),
		status: TestState,
		durationMs: Schema.Number,
		error: Schema.optional(ReportError),
	}),
	Schema.TaggedStruct("ModuleFinished", {
		modulePath: Schema.String,
		passCount: Schema.Number,
		failCount: Schema.Number,
		skipCount: Schema.Number,
		durationMs: Schema.Number,
	}),
	Schema.TaggedStruct("CoverageReady", {
		metrics: CoverageTotals,
		thresholds: MetricThresholds,
		gaps: Schema.Array(CoverageGap),
	}),
	Schema.TaggedStruct("ThresholdViolation", {
		metric: CoverageMetric,
		expected: Schema.Number,
		actual: Schema.Number,
	}),
	Schema.TaggedStruct("FailureClassified", {
		modulePath: Schema.String,
		testName: Schema.String,
		classification: TestClassification,
	}),
	Schema.TaggedStruct("SuggestedAction", {
		severity: ActionSeverity,
		title: Schema.String,
		detail: Schema.String,
		targetTool: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("RunFinished", {
		runId: Schema.String,
		finishedAt: Schema.String,
		passCount: Schema.Number,
		failCount: Schema.Number,
		skipCount: Schema.Number,
		durationMs: Schema.Number,
	}),
).annotations({ identifier: "RunEvent" });
export type RunEvent = typeof RunEvent.Type;

/**
 * Convenience: discriminator-keyed map of the individual variants.
 *
 * Useful for callers that want to construct an event by tag without
 * pulling the whole union shape into scope.
 */
export type RunEventByTag = {
	[E in RunEvent as E["_tag"]]: E;
};

/**
 * Helper alias for {@link FileCoverageReport} re-exported under the
 * event-domain name used in the spec.
 */
export { FileCoverageReport as CoverageFile };
