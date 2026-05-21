import { describe, expect, it } from "vitest";
import type { RenderState, RunEvent } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";
import { reduceRenderState, reduceRenderStateAll } from "../src/index.js";
import { allPassEvents, coverageViolationEvents, flakyRecoveryEvents, mixedFailEvents } from "./fixtures/events.js";

const apply = (events: ReadonlyArray<RunEvent>, seed: RenderState = initialRenderState): RenderState =>
	events.reduce<RenderState>(reduceRenderState, seed);

describe("reduceRenderState — individual events", () => {
	it("RunStarted sets phase, runId, configHash, and startedAt", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "RunStarted",
			runId: "r1",
			startedAt: "2026-05-12T00:00:00.000Z",
			configHash: "h1",
		});
		expect(next.phase).toBe("running");
		expect(next.runId).toBe("r1");
		expect(next.configHash).toBe("h1");
		expect(next.startedAt).toBe("2026-05-12T00:00:00.000Z");
		expect(next.finishedAt).toBeNull();
	});

	it("RunStarted after a previous run resets modules, moduleOrder, totals, coverage, trend, failures, and suggestedActions", () => {
		// First run: accumulate modules, totals, failures, coverage, trend, and a suggested action.
		const afterFirst = apply([
			{ _tag: "RunStarted", runId: "r1", startedAt: "T0", configHash: "h1" },
			{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: "T0" },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "t",
				suitePath: [],
				status: "failed",
				durationMs: 1,
				error: { message: "boom" },
			},
			{
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 1,
			},
			{
				_tag: "CoverageReady",
				metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
				thresholds: {},
				gaps: [],
			},
			{ _tag: "TrendComputed", direction: "stable", runCount: 3 },
			{ _tag: "SuggestedAction", severity: "info", title: "x", detail: "y" },
			{
				_tag: "RunFinished",
				runId: "r1",
				finishedAt: "T1",
				passCount: 0,
				failCount: 1,
				skipCount: 0,
				timeoutCount: 0,
				durationMs: 1,
			},
		]);
		expect(afterFirst.modules).not.toEqual({});
		expect(afterFirst.failures).toHaveLength(1);
		expect(afterFirst.coverage).not.toBeNull();
		expect(afterFirst.trend).not.toBeNull();
		expect(afterFirst.suggestedActions).toHaveLength(1);

		// Second `RunStarted` (watch mode rerun): everything from the previous
		// run must be wiped except the fresh-run identity fields.
		const afterRerunStart = reduceRenderState(afterFirst, {
			_tag: "RunStarted",
			runId: "r2",
			startedAt: "T2",
			configHash: "h2",
		});
		expect(afterRerunStart.modules).toEqual({});
		expect(afterRerunStart.moduleOrder).toEqual([]);
		expect(afterRerunStart.totals).toEqual({
			passCount: 0,
			failCount: 0,
			skipCount: 0,
			timeoutCount: 0,
			durationMs: 0,
		});
		expect(afterRerunStart.coverage).toBeNull();
		expect(afterRerunStart.trend).toBeNull();
		expect(afterRerunStart.failures).toEqual([]);
		expect(afterRerunStart.suggestedActions).toEqual([]);
		expect(afterRerunStart.phase).toBe("running");
		expect(afterRerunStart.runId).toBe("r2");
		expect(afterRerunStart.configHash).toBe("h2");
		expect(afterRerunStart.startedAt).toBe("T2");
		expect(afterRerunStart.finishedAt).toBeNull();
	});

	it("ModuleQueued upserts a module with status=queued", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleQueued",
			modulePath: "a.test.ts",
		});
		expect(next.modules["a.test.ts"]?.status).toBe("queued");
		expect(next.moduleOrder).toEqual(["a.test.ts"]);
	});

	it("ModuleQueued is idempotent — queueing twice does not duplicate", () => {
		const once = reduceRenderState(initialRenderState, { _tag: "ModuleQueued", modulePath: "a.test.ts" });
		const twice = reduceRenderState(once, { _tag: "ModuleQueued", modulePath: "a.test.ts" });
		expect(twice.moduleOrder).toEqual(["a.test.ts"]);
	});

	it("ModuleStarted promotes status to running", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{ _tag: "ModuleStarted", modulePath: "a.test.ts", startedAt: "x" },
		]);
		expect(next.modules["a.test.ts"]?.status).toBe("running");
	});

	it("ModuleStarted auto-queues if the module was not seen yet", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleStarted",
			modulePath: "a.test.ts",
			startedAt: "x",
		});
		expect(next.modules["a.test.ts"]?.status).toBe("running");
		expect(next.moduleOrder).toEqual(["a.test.ts"]);
	});

	it("TestStarted upserts a running test record", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{ _tag: "TestStarted", modulePath: "a.test.ts", testName: "t", suitePath: ["s"] },
		]);
		const tests = next.modules["a.test.ts"]?.tests ?? [];
		expect(tests).toHaveLength(1);
		expect(tests[0]).toMatchObject({
			testName: "t",
			suitePath: ["s"],
			status: "running",
			durationMs: null,
		});
	});

	it("TestFinished updates the existing test in place", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{ _tag: "TestStarted", modulePath: "a.test.ts", testName: "t", suitePath: ["s"] },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "t",
				suitePath: ["s"],
				status: "passed",
				durationMs: 4,
			},
		]);
		const tests = next.modules["a.test.ts"]?.tests ?? [];
		expect(tests).toHaveLength(1);
		expect(tests[0]).toMatchObject({ status: "passed", durationMs: 4 });
	});

	it("TestFinished failed pushes an unclassified failure record", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "t",
				suitePath: ["s"],
				status: "failed",
				durationMs: 3,
				error: { message: "boom" },
			},
		]);
		expect(next.failures).toHaveLength(1);
		expect(next.failures[0]).toMatchObject({
			modulePath: "a.test.ts",
			testName: "t",
			classification: null,
			error: { message: "boom" },
		});
	});

	it("ModuleFinished snapshots counts and recomputes totals", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{
				_tag: "ModuleFinished",
				modulePath: "a.test.ts",
				passCount: 3,
				failCount: 1,
				skipCount: 2,
				durationMs: 50,
			},
		]);
		expect(next.modules["a.test.ts"]).toMatchObject({
			status: "finished",
			passCount: 3,
			failCount: 1,
			skipCount: 2,
			durationMs: 50,
		});
		expect(next.totals).toEqual({ passCount: 3, failCount: 1, skipCount: 2, timeoutCount: 0, durationMs: 50 });
	});

	it("CoverageReady populates the coverage block with empty violations", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "CoverageReady",
			metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
			thresholds: { lines: 80 },
			gaps: [],
		});
		expect(next.coverage).toEqual({
			metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
			thresholds: { lines: 80 },
			gaps: [],
			violations: [],
		});
	});

	it("ThresholdViolation appends to coverage.violations when coverage exists", () => {
		const next = apply([
			{
				_tag: "CoverageReady",
				metrics: { lines: 70, branches: 70, functions: 70, statements: 70 },
				thresholds: { lines: 80 },
				gaps: [],
			},
			{ _tag: "ThresholdViolation", metric: "lines", expected: 80, actual: 70 },
		]);
		expect(next.coverage?.violations).toEqual([{ metric: "lines", expected: 80, actual: 70 }]);
	});

	it("ThresholdViolation without prior CoverageReady is dropped silently", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ThresholdViolation",
			metric: "lines",
			expected: 80,
			actual: 70,
		});
		expect(next.coverage).toBeNull();
	});

	it("FailureClassified updates the matching failure record in place", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "a.test.ts" },
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "t",
				suitePath: ["s"],
				status: "failed",
				durationMs: 1,
			},
			{ _tag: "FailureClassified", modulePath: "a.test.ts", testName: "t", classification: "flaky" },
		]);
		expect(next.failures[0]?.classification).toBe("flaky");
	});

	it("FailureClassified for an unknown test is a no-op (no spurious record)", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "FailureClassified",
			modulePath: "a.test.ts",
			testName: "ghost",
			classification: "new-failure",
		});
		expect(next.failures).toEqual([]);
	});

	it("SuggestedAction appends to the queue with optional targetTool", () => {
		const next = apply([
			{ _tag: "SuggestedAction", severity: "info", title: "a", detail: "b" },
			{ _tag: "SuggestedAction", severity: "warn", title: "c", detail: "d", targetTool: "run_tests" },
		]);
		expect(next.suggestedActions).toEqual([
			{ severity: "info", title: "a", detail: "b" },
			{ severity: "warn", title: "c", detail: "d", targetTool: "run_tests" },
		]);
	});

	it("RunFinished sets phase=finished, finishedAt, and overrides totals", () => {
		const next = apply([
			{ _tag: "RunStarted", runId: "r", startedAt: "x", configHash: "h" },
			{
				_tag: "RunFinished",
				runId: "r",
				finishedAt: "y",
				passCount: 7,
				failCount: 2,
				skipCount: 1,
				durationMs: 100,
			},
		]);
		expect(next.phase).toBe("finished");
		expect(next.finishedAt).toBe("y");
		expect(next.totals).toEqual({ passCount: 7, failCount: 2, skipCount: 1, timeoutCount: 0, durationMs: 100 });
	});
});

describe("reduceRenderStateAll — canonical fixtures", () => {
	it("allPassEvents finishes with no failures and matching totals", () => {
		const state = reduceRenderStateAll(allPassEvents);
		expect(state.phase).toBe("finished");
		expect(state.failures).toEqual([]);
		expect(state.totals).toEqual({ passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 80 });
		expect(state.coverage).toBeNull();
	});

	it("mixedFailEvents records the failing test and its classification", () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		expect(state.phase).toBe("finished");
		expect(state.totals).toEqual({ passCount: 2, failCount: 1, skipCount: 1, timeoutCount: 0, durationMs: 100 });
		expect(state.failures).toHaveLength(1);
		expect(state.failures[0]).toMatchObject({
			modulePath: "src/math.test.ts",
			testName: "divides",
			classification: "new-failure",
		});
		expect(state.failures[0]?.error?.diff).toContain("0.5000001");
		expect(state.suggestedActions).toHaveLength(1);
	});

	it("coverageViolationEvents finishes with two violations and a blocker action", () => {
		const state = reduceRenderStateAll(coverageViolationEvents);
		expect(state.phase).toBe("finished");
		expect(state.coverage?.metrics.lines).toBe(72.5);
		expect(state.coverage?.violations).toEqual([
			{ metric: "lines", expected: 80, actual: 72.5 },
			{ metric: "branches", expected: 80, actual: 60 },
		]);
		expect(state.coverage?.gaps).toHaveLength(1);
		expect(state.suggestedActions[0]?.severity).toBe("blocker");
	});

	it("flakyRecoveryEvents tracks one flaky failure and one recovered test", () => {
		const state = reduceRenderStateAll(flakyRecoveryEvents);
		expect(state.phase).toBe("finished");
		const classifications = state.failures.map((f) => `${f.testName}:${f.classification}`);
		expect(classifications).toEqual(["retries:flaky"]);
		expect(state.modules["src/network.test.ts"]?.tests.map((t) => t.testName)).toEqual(["retries", "times out"]);
		expect(state.suggestedActions[0]?.targetTool).toBe("run_tests");
	});

	it("folding produces a stable result regardless of seed identity", () => {
		const fresh = reduceRenderStateAll(allPassEvents);
		const seeded = reduceRenderStateAll(allPassEvents, { ...initialRenderState });
		expect(fresh).toEqual(seeded);
	});

	it("reducer is pure — applying the same event twice from the same state gives the same result", () => {
		const state = reduceRenderStateAll(mixedFailEvents);
		const event: RunEvent = {
			_tag: "SuggestedAction",
			severity: "info",
			title: "noop",
			detail: "noop",
		};
		const once = reduceRenderState(state, event);
		const twice = reduceRenderState(state, event);
		expect(once).toEqual(twice);
	});
});

describe("reduceRenderState — Part A completeness variants", () => {
	const running = reduceRenderState(initialRenderState, {
		_tag: "RunStarted",
		runId: "r1",
		startedAt: "T0",
		configHash: "h1",
	});

	it("RunTimedOut moves the run to the terminal timed-out phase", () => {
		const next = reduceRenderState(running, { _tag: "RunTimedOut", message: "process timeout" });
		expect(next.phase).toBe("timed-out");
	});

	const noopEvents: ReadonlyArray<RunEvent> = [
		{ _tag: "ModuleCollected", modulePath: "a.test.ts", testCount: 2, suiteCount: 1 },
		{ _tag: "SuiteStarted", modulePath: "a.test.ts", suitePath: [], suiteName: "math" },
		{
			_tag: "SuiteFinished",
			modulePath: "a.test.ts",
			suitePath: [],
			suiteName: "math",
			passCount: 2,
			failCount: 0,
			skipCount: 0,
		},
		{ _tag: "HookStarted", modulePath: "a.test.ts", hookType: "beforeAll", scopeName: "math" },
		{
			_tag: "HookFinished",
			modulePath: "a.test.ts",
			hookType: "beforeAll",
			scopeName: "math",
			durationMs: 3,
			status: "passed",
		},
		{ _tag: "ConsoleLog", level: "stdout", content: "log line", time: 0 },
		{ _tag: "TestAnnotated", modulePath: "a.test.ts", testName: "adds", suitePath: [], annotation: "slow" },
		{ _tag: "TestArtifactRecorded", modulePath: "a.test.ts", testName: "adds", suitePath: [], artifact: "screenshot" },
		{ _tag: "WatcherReady" },
		{ _tag: "WatcherRerun", triggerFiles: ["a.test.ts"] },
	];

	for (const event of noopEvents) {
		it(`${event._tag} passes through as a no-op leaving state unchanged`, () => {
			expect(reduceRenderState(running, event)).toBe(running);
		});
	}
});

describe("reduceRenderState — project dimension", () => {
	it("ModuleQueued threads projectName onto the module record", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleQueued",
			modulePath: "a.test.ts",
			projectName: "ui",
		});
		expect(next.modules["a.test.ts"]?.projectName).toBe("ui");
	});

	it("ModuleStarted threads projectName and the start stamp onto the module record", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleStarted",
			modulePath: "a.test.ts",
			startedAt: "2026-05-19T00:00:00.000Z",
			projectName: "sdk",
		});
		expect(next.modules["a.test.ts"]?.projectName).toBe("sdk");
		expect(next.modules["a.test.ts"]?.startedAt).toBe("2026-05-19T00:00:00.000Z");
	});

	it("ModuleFinished threads projectName onto the module record", () => {
		const seed = reduceRenderState(initialRenderState, { _tag: "ModuleQueued", modulePath: "a.test.ts" });
		const next = reduceRenderState(seed, {
			_tag: "ModuleFinished",
			modulePath: "a.test.ts",
			passCount: 1,
			failCount: 0,
			skipCount: 0,
			durationMs: 5,
			projectName: "plugin",
		});
		expect(next.modules["a.test.ts"]?.projectName).toBe("plugin");
	});

	it("leaves projectName undefined for a project-less module event", () => {
		const next = reduceRenderState(initialRenderState, { _tag: "ModuleQueued", modulePath: "a.test.ts" });
		expect(next.modules["a.test.ts"]?.projectName).toBeUndefined();
	});
});

describe("reduceRenderState — timeout routing", () => {
	it("a timed-out TestFinished sets the test status to timed-out", () => {
		const next = reduceRenderState(
			reduceRenderState(initialRenderState, { _tag: "ModuleQueued", modulePath: "a.test.ts" }),
			{
				_tag: "TestFinished",
				modulePath: "a.test.ts",
				testName: "slow",
				suitePath: [],
				status: "failed",
				durationMs: 5000,
				timedOut: true,
			},
		);
		expect(next.modules["a.test.ts"]?.tests[0]?.status).toBe("timed-out");
	});

	it("a timed-out failure record is flagged timedOut", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "TestFinished",
			modulePath: "a.test.ts",
			testName: "slow",
			suitePath: [],
			status: "failed",
			durationMs: 5000,
			timedOut: true,
		});
		expect(next.failures[0]?.timedOut).toBe(true);
	});

	it("ModuleFinished threads timeoutCount and recomputeTotals sums it", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleFinished",
			modulePath: "a.test.ts",
			passCount: 8,
			failCount: 1,
			skipCount: 0,
			timeoutCount: 2,
			durationMs: 50,
		});
		expect(next.modules["a.test.ts"]?.timeoutCount).toBe(2);
		expect(next.totals.timeoutCount).toBe(2);
	});

	it("RunFinished carries timeoutCount into totals", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "RunFinished",
			runId: "r",
			finishedAt: "T1",
			passCount: 10,
			failCount: 1,
			skipCount: 0,
			timeoutCount: 3,
			durationMs: 100,
		});
		expect(next.totals.timeoutCount).toBe(3);
	});
});

describe("reduceRenderState — TrendComputed", () => {
	it("folds TrendComputed into state.trend", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "TrendComputed",
			direction: "regressing",
			runCount: 5,
		});
		expect(next.trend).toEqual({ direction: "regressing", runCount: 5 });
	});
});

describe("reduceRenderState — module tag counts", () => {
	it("ModuleFinished threads tagCounts onto the module record", () => {
		const next = reduceRenderState(initialRenderState, {
			_tag: "ModuleFinished",
			modulePath: "a.test.ts",
			passCount: 961,
			failCount: 0,
			skipCount: 0,
			timeoutCount: 0,
			durationMs: 5,
			tagCounts: { int: 6, unit: 955 },
		});
		expect(next.modules["a.test.ts"]?.tagCounts).toEqual({ int: 6, unit: 955 });
	});

	it("TestFinished with expected/received lands both fields on the failure record", () => {
		const next = apply([
			{ _tag: "ModuleQueued", modulePath: "math.test.ts" },
			{
				_tag: "TestFinished",
				modulePath: "math.test.ts",
				testName: "adds",
				suitePath: [],
				status: "failed",
				durationMs: 2,
				error: {
					message: "AssertionError: expected 3 to be 4",
					expected: "4",
					received: "3",
				},
			},
		]);
		expect(next.failures).toHaveLength(1);
		expect(next.failures[0]).toMatchObject({
			modulePath: "math.test.ts",
			testName: "adds",
			error: {
				message: "AssertionError: expected 3 to be 4",
				expected: "4",
				received: "3",
			},
		});
	});
});
