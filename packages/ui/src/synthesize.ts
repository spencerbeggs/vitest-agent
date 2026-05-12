/**
 * Convert post-run Vitest module/test data into an ordered
 * {@link RunEvent} sequence suitable for replay through the reducer
 * and renderers.
 *
 * The synthesizer is the bridge between Vitest's "batch end-of-run"
 * reporter API and the event-sourced renderer pipeline. It does not
 * fire per-test events as tests run — for live progress, the host
 * publishes RunEvents from streaming reporter callbacks instead.
 * Batch synthesis is what every CLI replay command and the current
 * AgentReporter call site rely on.
 *
 * @packageDocumentation
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
} from "vitest-agent-sdk";

/**
 * Optional metadata threaded through the synthesized event stream.
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

export interface SynthesizedCoverage {
	readonly metrics: CoverageTotals;
	readonly thresholds: MetricThresholds;
	readonly gaps: ReadonlyArray<CoverageGap>;
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
 * {@link RunEvent} stream. The output is deterministic given a
 * stable input.
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
	const failureBatches: Array<{ modulePath: string; testName: string }> = [];

	for (const mod of modules) {
		events.push({ _tag: "ModuleStarted", modulePath: mod.relativeModuleId, startedAt });

		let pass = 0;
		let fail = 0;
		let skip = 0;
		const moduleDuration = mod.diagnostic()?.duration ?? 0;
		totalDuration += moduleDuration;

		for (const test of mod.children.allTests()) {
			const suitePath = collectSuitePath(test);
			const result = test.result();
			const diag = test.diagnostic();
			const status = normalizeTestState(result?.state);
			const durationMs = diag?.duration ?? 0;

			events.push({
				_tag: "TestStarted",
				modulePath: mod.relativeModuleId,
				testName: test.name,
				suitePath,
			});

			const error = mapTestError(result?.errors);
			events.push({
				_tag: "TestFinished",
				modulePath: mod.relativeModuleId,
				testName: test.name,
				suitePath,
				status,
				durationMs,
				...(error !== undefined && { error }),
			});

			if (status === "passed") pass++;
			else if (status === "failed") {
				fail++;
				failureBatches.push({ modulePath: mod.relativeModuleId, testName: test.name });
			} else skip++;
		}

		events.push({
			_tag: "ModuleFinished",
			modulePath: mod.relativeModuleId,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
			durationMs: moduleDuration,
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
	});

	return events;
};

/**
 * Options for {@link synthesizeFromAgentReport}.
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
 * Bridge a persisted {@link AgentReport} into a {@link RunEvent} stream.
 *
 * AgentReport stores only failed modules in detail; passed-only modules
 * are summarized via `summary.passed` without per-module breakdown. The
 * synthesized stream reflects this — it emits per-test events for the
 * failed modules and lets `RunFinished` carry the authoritative totals.
 * Renderers see "N passed, M failed" in the header while the Modules
 * section enumerates only the failing modules. The agent-mode collapse
 * "N modules all-passed" remains accurate because failed modules are
 * counted as interesting.
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

	for (const mod of report.failed) {
		events.push({ _tag: "ModuleStarted", modulePath: mod.file, startedAt });

		let pass = 0;
		let fail = 0;
		let skip = 0;
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

			events.push({
				_tag: "TestFinished",
				modulePath: mod.file,
				testName: test.name,
				suitePath,
				status: test.state,
				durationMs: test.duration ?? 0,
				...(error !== undefined && { error }),
			});

			if (test.state === "passed") pass++;
			else if (test.state === "failed") fail++;
			else skip++;
		}

		events.push({
			_tag: "ModuleFinished",
			modulePath: mod.file,
			passCount: pass,
			failCount: fail,
			skipCount: skip,
			durationMs: moduleDuration,
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
		failCount: report.summary.failed,
		skipCount: report.summary.skipped,
		durationMs: report.summary.duration,
	});

	return events;
};
