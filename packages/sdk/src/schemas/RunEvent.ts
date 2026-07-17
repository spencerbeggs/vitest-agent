import { Schema } from "effect";
import { ReportError, TestClassification, TestState } from "./Common.js";
import { CoverageTotals, FileCoverageReport } from "./Coverage.js";
import { MetricThresholds } from "./Thresholds.js";

// --- Helper shapes ---

/**
 * Coverage metric whose threshold can be violated independently.
 * @public
 */
export const CoverageMetric = Schema.Literals(["lines", "branches", "functions", "statements"]).annotate({
	identifier: "CoverageMetric",
});
/** @public */
export type CoverageMetric = typeof CoverageMetric.Type;

/**
 * Severity tier for a suggested action emitted during a run.
 * @public
 */
export const ActionSeverity = Schema.Literals(["info", "warn", "blocker"]).annotate({
	identifier: "ActionSeverity",
});
/** @public */
export type ActionSeverity = typeof ActionSeverity.Type;

/**
 * Lifecycle scope of a Vitest setup/teardown hook.
 * @public
 */
export const HookType = Schema.Literals(["beforeAll", "afterAll", "beforeEach", "afterEach"]).annotate({
	identifier: "HookType",
});
/** @public */
export type HookType = typeof HookType.Type;

/**
 * Terminal status of a Vitest hook run.
 * @public
 */
export const HookStatus = Schema.Literals(["passed", "failed"]).annotate({ identifier: "HookStatus" });
/** @public */
export type HookStatus = typeof HookStatus.Type;

/**
 * Output stream a captured user `console.log` was written to.
 * @public
 */
export const ConsoleLogLevel = Schema.Literals(["stdout", "stderr"]).annotate({ identifier: "ConsoleLogLevel" });
/** @public */
export type ConsoleLogLevel = typeof ConsoleLogLevel.Type;

/**
 * A coverage gap surfaced to the renderer — a per-file shortfall that
 * a renderer may want to call out individually.
 * @public
 */
export const CoverageGap = Schema.Struct({
	file: Schema.String,
	missing: CoverageTotals,
	uncoveredLines: Schema.optional(Schema.String),
}).annotate({ identifier: "CoverageGap" });
/** @public */
export type CoverageGap = typeof CoverageGap.Type;

// --- Discriminated union ---

/**
 * The reducer projects this union into `RenderState`. Renderers
 * never read the raw event stream — they read the projected state.
 *
 * @remarks
 * Adding a variant here is one change in one place; the reducer's
 * exhaustive `Match.exhaustive` will surface any renderer that hasn't
 * been updated to consume the new state shape.
 * @public
 */
export const RunEvent = Schema.Union([
	Schema.TaggedStruct("RunStarted", {
		runId: Schema.String,
		startedAt: Schema.String,
		configHash: Schema.String,
	}),
	Schema.TaggedStruct("ModuleQueued", {
		modulePath: Schema.String,
		projectName: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("ModuleStarted", {
		modulePath: Schema.String,
		startedAt: Schema.String,
		projectName: Schema.optional(Schema.String),
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
		timedOut: Schema.optional(Schema.Boolean),
	}),
	Schema.TaggedStruct("ModuleFinished", {
		modulePath: Schema.String,
		passCount: Schema.Number,
		failCount: Schema.Number,
		skipCount: Schema.Number,
		durationMs: Schema.Number,
		projectName: Schema.optional(Schema.String),
		timeoutCount: Schema.optional(Schema.Number),
		tagCounts: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
	}),
	Schema.TaggedStruct("ModuleCollected", {
		modulePath: Schema.String,
		testCount: Schema.Number,
		suiteCount: Schema.Number,
	}),
	Schema.TaggedStruct("SuiteStarted", {
		modulePath: Schema.String,
		suitePath: Schema.Array(Schema.String),
		suiteName: Schema.String,
	}),
	Schema.TaggedStruct("SuiteFinished", {
		modulePath: Schema.String,
		suitePath: Schema.Array(Schema.String),
		suiteName: Schema.String,
		passCount: Schema.Number,
		failCount: Schema.Number,
		skipCount: Schema.Number,
	}),
	Schema.TaggedStruct("HookStarted", {
		modulePath: Schema.String,
		hookType: HookType,
		scopeName: Schema.String,
	}),
	Schema.TaggedStruct("HookFinished", {
		modulePath: Schema.String,
		hookType: HookType,
		scopeName: Schema.String,
		durationMs: Schema.Number,
		status: HookStatus,
		error: Schema.optional(ReportError),
	}),
	Schema.TaggedStruct("ConsoleLog", {
		modulePath: Schema.optional(Schema.String),
		testName: Schema.optional(Schema.String),
		level: ConsoleLogLevel,
		content: Schema.String,
		time: Schema.Number,
	}),
	Schema.TaggedStruct("RunTimedOut", {
		message: Schema.String,
	}),
	Schema.TaggedStruct("TestAnnotated", {
		modulePath: Schema.String,
		testName: Schema.String,
		suitePath: Schema.Array(Schema.String),
		annotation: Schema.String,
	}),
	Schema.TaggedStruct("TestArtifactRecorded", {
		modulePath: Schema.String,
		testName: Schema.String,
		suitePath: Schema.Array(Schema.String),
		artifact: Schema.String,
	}),
	Schema.TaggedStruct("WatcherReady", {}),
	Schema.TaggedStruct("WatcherRerun", {
		triggerFiles: Schema.Array(Schema.String),
		reason: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("TrendComputed", {
		direction: Schema.Literals(["improving", "regressing", "stable"]),
		runCount: Schema.Number,
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
		timeoutCount: Schema.optional(Schema.Number),
	}),
]).annotate({ identifier: "RunEvent" });
/** @public */
export type RunEvent = typeof RunEvent.Type;

/**
 * Convenience: discriminator-keyed map of the individual variants.
 *
 * Useful for callers that want to construct an event by tag without
 * pulling the whole union shape into scope.
 * @public
 */
export type RunEventByTag = {
	[E in RunEvent as E["_tag"]]: E;
};

/**
 * Helper alias for {@link FileCoverageReport} re-exported under the
 * event-domain name used in the spec.
 * @public
 */
export { FileCoverageReport as CoverageFile };
