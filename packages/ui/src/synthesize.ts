/**
 * Convert post-run Vitest module/test data into an ordered
 * `RunEvent` sequence suitable for replay through the reducer
 * and renderers.
 *
 * The synthesizer is the bridge between Vitest's "batch end-of-run"
 * reporter API and the event-sourced renderer pipeline. It does not
 * fire per-test events as tests run — for live progress, the host
 * publishes RunEvents from streaming reporter callbacks instead.
 * Batch synthesis is what every CLI replay command and the current
 * AgentReporter call site rely on.
 */

import type {
	ActionSeverity,
	AgentReport,
	CoverageGap,
	CoverageMetric,
	CoverageTotals,
	MetricThresholds,
	ReportError,
	RunEvent,
	TestClassification,
	TestState,
	VitestTestCase,
	VitestTestModule,
	VitestTestSuite,
} from "@vitest-agent/sdk";
import { isTimeoutError } from "@vitest-agent/sdk";

/**
 * Synthetic test name used to surface a suite-level (collection/load)
 * failure in the Failures detail. A module that fails to import has no real
 * test case to attach the error to, so the synthesizer emits one failed
 * "test" under this label carrying the module's import error.
 *
 * @public
 */
export const SUITE_LOAD_FAILURE_LABEL = "test suite failed to load";

/**
 * Optional metadata threaded through the synthesized event stream.
 *
 * @public
 */
export interface SynthesizeOptions {
	readonly runId?: string;
	readonly configHash?: string;
	readonly startedAt?: string;
	readonly finishedAt?: string;
	readonly classifications?: ReadonlyMap<string, TestClassification>;
	readonly coverage?: SynthesizedCoverage;
	readonly suggestedActions?: ReadonlyArray<{
		readonly severity: ActionSeverity;
		readonly title: string;
		readonly detail: string;
		readonly targetTool?: string;
	}>;
}

/**
 * Coverage data to thread into the synthesized event stream.
 *
 * @public
 */
export interface SynthesizedCoverage {
	/** Aggregated coverage totals for each metric. */
	readonly metrics: CoverageTotals;
	/** The configured threshold values for each metric. */
	readonly thresholds: MetricThresholds;
	/** Per-file coverage gaps (files below threshold). */
	readonly gaps: ReadonlyArray<CoverageGap>;
	/** Threshold violations to emit as `ThresholdViolation` events. */
	readonly violations?: ReadonlyArray<{
		readonly metric: CoverageMetric;
		readonly expected: number;
		readonly actual: number;
	}>;
}

const ISO_ZERO = "1970-01-01T00:00:00.000Z";

const normalizeTestState = (state: string | undefined): TestState => {
	if (state === "passed") return "passed";
	if (state === "failed") return "failed";
	if (state === "skipped") return "skipped";
	return "pending";
};

const formatStack = (
	stacks: ReadonlyArray<string | { method: string; file: string; line: number; column: number }> | undefined,
): string | undefined => {
	if (!stacks || stacks.length === 0) return undefined;
	return stacks
		.map((frame) => {
			if (typeof frame === "string") return frame;
			const method = frame.method.length > 0 ? frame.method : "<anonymous>";
			return `at ${method} (${frame.file}:${frame.line}:${frame.column})`;
		})
		.join("\n");
};

const mapTestError = (
	errors:
		| ReadonlyArray<{
				message: string;
				diff?: string;
				stacks?: ReadonlyArray<string | { method: string; file: string; line: number; column: number }>;
		  }>
		| undefined,
): ReportError | undefined => {
	if (!errors || errors.length === 0) return undefined;
	const first = errors[0];
	if (first === undefined) return undefined;
	const stack = formatStack(first.stacks);
	const out: { message: string; diff?: string; stack?: string } = { message: first.message };
	if (first.diff !== undefined) out.diff = first.diff;
	if (stack !== undefined) out.stack = stack;
	return out as ReportError;
};

const collectSuitePath = (test: VitestTestCase): string[] => {
	const path: string[] = [];
	let cursor: VitestTestSuite | VitestTestModule | undefined = test.parent;
	while (cursor !== undefined && cursor.type === "suite") {
		path.unshift(cursor.name);
		cursor = cursor.parent;
	}
	return path;
};

/**
 * Project a fully-completed Vitest run into the canonical
 * `RunEvent` stream. The output is deterministic given a
 * stable input.
 *
 * @param modules - the array of completed Vitest test modules
 * @param options - optional metadata to thread into the event stream
 * @returns an ordered array of run events
 * @public
 */
export const synthesizeRunEvents = (
	modules: ReadonlyArray<VitestTestModule>,
	options: SynthesizeOptions = {},
): RunEvent[] => {
	const runId = options.runId ?? "synthetic-run";
	const configHash = options.configHash ?? "synthetic-config";
	const startedAt = options.startedAt ?? ISO_ZERO;
	const finishedAt = options.finishedAt ?? startedAt;
	const classifications = options.classifications ?? new Map<string, TestClassification>();

	const events: RunEvent[] = [];

	events.push({ _tag: "RunStarted", runId, startedAt, configHash });

	for (const mod of modules) {
		events.push({ _tag: "ModuleQueued", modulePath: mod.relativeModuleId });
	}

	let totalPass = 0;
	let totalFail = 0;
	let totalSkip = 0;
	let totalDuration = 0;
	let totalTimeout = 0;
	const failureBatches: Array<{ modulePath: string; testName: string }> = [];

	for (const mod of modules) {
		events.push({ _tag: "ModuleStarted", modulePath: mod.relativeModuleId, startedAt });

		let pass = 0;
		let fail = 0;
		let skip = 0;
		let moduleTimeout = 0;
		const moduleDuration = mod.diagnostic()?.duration ?? 0;
		totalDuration += moduleDuration;

		const moduleTagCounts: Record<string, number> = {};

		for (const test of mod.children.allTests()) {
			const suitePath = collectSuitePath(test);
			const result = test.result();
			const diag = test.diagnostic();
			const status = normalizeTestState(result?.state);
			const durationMs = diag?.duration ?? 0;

			// Accumulate tag counts for this module.
			for (const tag of test.tags) {
				moduleTagCounts[tag] = (moduleTagCounts[tag] ?? 0) + 1;
			}

			events.push({
				_tag: "TestStarted",
				modulePath: mod.relativeModuleId,
				testName: test.name,
				suitePath,
			});

			const error = mapTestError(result?.errors);
			const firstErrorMsg = result?.errors?.[0]?.message;
			const timedOut = status === "failed" && firstErrorMsg !== undefined && isTimeoutError({ message: firstErrorMsg });

			if (timedOut) moduleTimeout++;

			events.push({
				_tag: "TestFinished",
				modulePath: mod.relativeModuleId,
				testName: test.name,
				suitePath,
				status,
				durationMs,
				...(error !== undefined && { error }),
				...(timedOut && { timedOut: true }),
			});

			if (status === "passed") pass++;
			else if (status === "failed") {
				// Mirror the live reporter's split (reporter.ts onTestModuleEnd):
				// a timed-out test is counted in timeoutCount (incremented above),
				// not failCount. Incrementing both would render the test as `✗1 ⧖1`
				// on replay versus `✗0 ⧖1` live and inflate the Total line. The test
				// still joins failureBatches because the reducer keeps timed-out
				// tests in the failures list (rendered with the ⧖ glyph).
				if (!timedOut) fail++;
				failureBatches.push({ modulePath: mod.relativeModuleId, testName: test.name });
			} else skip++;
		}

		totalTimeout += moduleTimeout;

		const hasTagCounts = Object.keys(moduleTagCounts).length > 0;

		events.push({
			_tag: "ModuleFinished",
			modulePath: mod.relativeModuleId,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
			durationMs: moduleDuration,
			...(moduleTimeout > 0 && { timeoutCount: moduleTimeout }),
			...(hasTagCounts && { tagCounts: moduleTagCounts }),
		});

		totalPass += pass;
		totalFail += fail;
		totalSkip += skip;
	}

	if (options.coverage !== undefined) {
		const cov = options.coverage;
		events.push({
			_tag: "CoverageReady",
			metrics: cov.metrics,
			thresholds: cov.thresholds,
			gaps: cov.gaps,
		});
		if (cov.violations !== undefined) {
			for (const v of cov.violations) {
				events.push({ _tag: "ThresholdViolation", metric: v.metric, expected: v.expected, actual: v.actual });
			}
		}
	}

	for (const failure of failureBatches) {
		const classification = classifications.get(failure.testName);
		if (classification !== undefined) {
			events.push({
				_tag: "FailureClassified",
				modulePath: failure.modulePath,
				testName: failure.testName,
				classification,
			});
		}
	}

	if (options.suggestedActions !== undefined) {
		for (const action of options.suggestedActions) {
			events.push({
				_tag: "SuggestedAction",
				severity: action.severity,
				title: action.title,
				detail: action.detail,
				...(action.targetTool !== undefined && { targetTool: action.targetTool }),
			});
		}
	}

	events.push({
		_tag: "RunFinished",
		runId,
		finishedAt,
		passCount: totalPass,
		failCount: totalFail,
		skipCount: totalSkip,
		durationMs: totalDuration,
		...(totalTimeout > 0 && { timeoutCount: totalTimeout }),
	});

	return events;
};

/**
 * Options for {@link synthesizeFromAgentReport}.
 *
 * @public
 */
export interface SynthesizeFromAgentReportOptions {
	/** Override runId; defaults to `report.timestamp`. */
	readonly runId?: string;
	/** Override startedAt; defaults to `report.timestamp`. */
	readonly startedAt?: string;
	/** Override finishedAt; defaults to `report.timestamp`. */
	readonly finishedAt?: string;
	/** configHash placeholder; AgentReport does not carry one. */
	readonly configHash?: string;
	/** Optional suggested actions appended before RunFinished. */
	readonly suggestedActions?: SynthesizeOptions["suggestedActions"];
}

const coverageReportToBlock = (report: AgentReport): SynthesizedCoverage | undefined => {
	const cov = report.coverage;
	if (cov === undefined) return undefined;

	const violations: Array<{ metric: CoverageMetric; expected: number; actual: number }> = [];
	const metricKeys: Array<CoverageMetric> = ["lines", "branches", "functions", "statements"];
	for (const metric of metricKeys) {
		const expected = cov.thresholds.global[metric];
		const actual = cov.totals[metric];
		if (expected !== undefined && actual < expected) {
			violations.push({ metric, expected, actual });
		}
	}

	const gaps: CoverageGap[] = cov.lowCoverage.map((f) => ({
		file: f.file,
		missing: f.summary,
		uncoveredLines: f.uncoveredLines.length > 0 ? f.uncoveredLines : undefined,
	}));

	return {
		metrics: cov.totals,
		thresholds: cov.thresholds.global,
		gaps,
		violations,
	};
};

/**
 * Bridge a persisted `AgentReport` into a `RunEvent` stream.
 *
 * `AgentReport` stores only failed modules in detail; passed-only modules
 * are summarized via `summary.passed` without per-module breakdown. The
 * synthesized stream reflects this — it emits per-test events for the
 * failed modules and lets `RunFinished` carry the authoritative totals.
 * Renderers see "N passed, M failed" in the header while the Modules
 * section enumerates only the failing modules.
 *
 * @param report - the persisted agent report to synthesize from
 * @param options - optional overrides for run metadata
 * @returns an ordered array of run events
 * @public
 */
export const synthesizeFromAgentReport = (
	report: AgentReport,
	options: SynthesizeFromAgentReportOptions = {},
): RunEvent[] => {
	const runId = options.runId ?? report.timestamp;
	const startedAt = options.startedAt ?? report.timestamp;
	const finishedAt = options.finishedAt ?? report.timestamp;
	const configHash = options.configHash ?? "agent-report";

	const events: RunEvent[] = [];
	events.push({ _tag: "RunStarted", runId, startedAt, configHash });

	for (const mod of report.failed) {
		events.push({ _tag: "ModuleQueued", modulePath: mod.file });
	}

	let totalTimeoutCount = 0;
	let suiteFailureCount = 0;

	for (const mod of report.failed) {
		events.push({ _tag: "ModuleStarted", modulePath: mod.file, startedAt });

		let pass = 0;
		let fail = 0;
		let skip = 0;
		let moduleTimeoutCount = 0;
		const moduleDuration = mod.duration ?? 0;

		for (const test of mod.tests) {
			// Reconstructing suitePath from fullName is lossy. Vitest joins
			// suite/test names with " > " without escaping, so a suite name
			// that literally contains " > " (e.g.
			// `describe("foo > bar", () => { it("baz") })`) splits into two
			// fake levels here. Test names containing " > " are handled
			// correctly because the known `test.name` is stripped from the
			// end before splitting — only the prefix is ambiguous.
			//
			// The structured suite chain exists at write time in the
			// reporter (via testCase.parent walking) but is not persisted
			// on AgentReport.failed[].tests[]. Eliminating this ambiguity
			// requires extending TestReport with a suitePath: string[]
			// field — tracked as a follow-up.
			const suitePath: string[] =
				test.fullName !== test.name && test.fullName.endsWith(` > ${test.name}`)
					? test.fullName
							.slice(0, -` > ${test.name}`.length)
							.split(" > ")
							.filter((s) => s.length > 0)
					: [];

			events.push({
				_tag: "TestStarted",
				modulePath: mod.file,
				testName: test.name,
				suitePath,
			});

			const firstError = test.errors?.[0];
			const error: ReportError | undefined =
				firstError !== undefined
					? {
							message: firstError.message,
							...(firstError.diff !== undefined && { diff: firstError.diff }),
							...(firstError.stack !== undefined && { stack: firstError.stack }),
						}
					: undefined;

			const timedOut =
				test.state === "failed" && firstError !== undefined && isTimeoutError({ message: firstError.message });

			if (timedOut) moduleTimeoutCount++;

			events.push({
				_tag: "TestFinished",
				modulePath: mod.file,
				testName: test.name,
				suitePath,
				status: test.state,
				durationMs: test.duration ?? 0,
				...(error !== undefined && { error }),
				...(timedOut && { timedOut: true }),
			});

			if (test.state === "passed") pass++;
			// Mirror the live split: a timed-out test counts in timeoutCount
			// (above), not failCount. See synthesizeRunEvents for the rationale.
			else if (test.state === "failed") {
				if (!timedOut) fail++;
			} else skip++;
		}

		// A module that landed in `report.failed` with no failed test case and
		// no timeout is a suite-level (collection/load) failure — an import
		// error or top-level throw. It contributes nothing to `summary.failed`
		// (which stays tied to test cases), so surface it here: count it as one
		// failed unit AND emit a synthetic failed "test" carrying the module
		// error, so the file and its import error show up in the Failures
		// detail (there is no real test case to attach the error to). Without
		// this the run renders all-green while the process exits non-zero.
		if (fail === 0 && moduleTimeoutCount === 0) {
			fail = 1;
			suiteFailureCount++;
			const moduleError = mod.errors?.[0];
			events.push({ _tag: "TestStarted", modulePath: mod.file, testName: SUITE_LOAD_FAILURE_LABEL, suitePath: [] });
			events.push({
				_tag: "TestFinished",
				modulePath: mod.file,
				testName: SUITE_LOAD_FAILURE_LABEL,
				suitePath: [],
				status: "failed",
				durationMs: 0,
				...(moduleError !== undefined && {
					error: {
						message: moduleError.message,
						...(moduleError.diff !== undefined && { diff: moduleError.diff }),
						...(moduleError.stack !== undefined && { stack: moduleError.stack }),
					},
				}),
			});
		}

		totalTimeoutCount += moduleTimeoutCount;

		// AgentReport carries only run-level tagCounts, not per-module
		// breakdowns, and TestReport does not persist test-level tags — so
		// per-module tag counts cannot be reconstructed at replay time.
		// Attaching the run-level totals to every failed module over-counted
		// them: `mergeTagCounts` sums each module in the workspace rollup, so
		// N failed modules multiplied every per-tag total by N, and every
		// per-module row read as the run total rather than its own
		// contribution. The replay path therefore omits per-module tagCounts
		// entirely rather than emit wrong numbers. Restoring a correct tag
		// suffix on replay needs either a run-level slot on RunFinished plus a
		// Total-line renderer, or test-level tags persisted on TestReport.
		events.push({
			_tag: "ModuleFinished",
			modulePath: mod.file,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
			durationMs: moduleDuration,
			...(moduleTimeoutCount > 0 && { timeoutCount: moduleTimeoutCount }),
		});
	}

	const coverage = coverageReportToBlock(report);
	if (coverage !== undefined) {
		events.push({
			_tag: "CoverageReady",
			metrics: coverage.metrics,
			thresholds: coverage.thresholds,
			gaps: coverage.gaps,
		});
		if (coverage.violations !== undefined) {
			for (const v of coverage.violations) {
				events.push({
					_tag: "ThresholdViolation",
					metric: v.metric,
					expected: v.expected,
					actual: v.actual,
				});
			}
		}
	}

	for (const mod of report.failed) {
		for (const test of mod.tests) {
			if (test.state === "failed" && test.classification !== undefined) {
				events.push({
					_tag: "FailureClassified",
					modulePath: mod.file,
					testName: test.name,
					classification: test.classification,
				});
			}
		}
	}

	if (options.suggestedActions !== undefined) {
		for (const action of options.suggestedActions) {
			events.push({
				_tag: "SuggestedAction",
				severity: action.severity,
				title: action.title,
				detail: action.detail,
				...(action.targetTool !== undefined && { targetTool: action.targetTool }),
			});
		}
	}

	events.push({
		_tag: "RunFinished",
		runId,
		finishedAt,
		passCount: report.summary.passed,
		// summary.failed counts failed test cases only; add suite-level
		// (collection/load) failures so RunFinished — which the reducer uses to
		// set the authoritative run totals — classifies the run as failed and
		// routes to the some-fail render cell (which shows the Failures detail).
		failCount: report.summary.failed + suiteFailureCount,
		skipCount: report.summary.skipped,
		durationMs: report.summary.duration,
		...(totalTimeoutCount > 0 && { timeoutCount: totalTimeoutCount }),
	});

	return events;
};
