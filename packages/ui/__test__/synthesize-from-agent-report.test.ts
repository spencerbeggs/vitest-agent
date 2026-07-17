import type { AgentReport } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import {
	SUITE_LOAD_FAILURE_LABEL,
	reduceRenderStateAll,
	renderAgent,
	synthesizeFromAgentReport,
} from "../src/index.js";

const baseReport = (overrides: Partial<AgentReport> = {}): AgentReport => ({
	timestamp: "2026-05-12T00:00:00.000Z",
	reason: "passed",
	summary: { total: 3, passed: 3, failed: 0, skipped: 0, duration: 50 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...overrides,
});

describe("synthesizeFromAgentReport — structural shape", () => {
	it("emits RunStarted then RunFinished for an all-pass report", () => {
		const events = synthesizeFromAgentReport(baseReport());
		const tags = events.map((e) => e._tag);
		expect(tags[0]).toBe("RunStarted");
		expect(tags.at(-1)).toBe("RunFinished");
		expect(tags).not.toContain("ModuleQueued");
	});

	it("emits per-module events for each failed module", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 2, passed: 0, failed: 2, skipped: 0, duration: 20 },
				failed: [
					{
						file: "src/math.test.ts",
						state: "failed",
						duration: 14,
						tests: [
							{
								name: "divides",
								fullName: "math > divides",
								state: "failed",
								duration: 7,
								errors: [{ message: "boom", diff: "- x\n+ y" }],
							},
						],
					},
				],
				failedFiles: ["src/math.test.ts"],
			}),
		);
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("ModuleQueued");
		expect(tags).toContain("ModuleStarted");
		expect(tags).toContain("TestStarted");
		expect(tags).toContain("TestFinished");
		expect(tags).toContain("ModuleFinished");
	});

	it("extracts suitePath from TestReport fullName", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "a.test.ts",
						state: "failed",
						tests: [
							{
								name: "throws",
								fullName: "outer > inner > throws",
								state: "failed",
							},
						],
					},
				],
			}),
		);
		const started = events.find((e) => e._tag === "TestStarted");
		expect(started).toMatchObject({ testName: "throws", suitePath: ["outer", "inner"] });
	});
});

describe("synthesizeFromAgentReport — totals authority", () => {
	it("RunFinished totals come from summary even when failed[] is partial", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 10, passed: 9, failed: 1, skipped: 0, duration: 200 },
				failed: [
					{
						file: "a.test.ts",
						state: "failed",
						tests: [{ name: "broken", fullName: "broken", state: "failed", duration: 5 }],
					},
				],
			}),
		);
		const state = reduceRenderStateAll(events);
		expect(state.totals).toEqual({ passCount: 9, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 200 });
		const output = renderAgent(state);
		expect(output).toContain("Tests: 9/10 passed, 1 failed (200ms)");
	});
});

describe("synthesizeFromAgentReport — coverage", () => {
	it("emits CoverageReady and synthesizes ThresholdViolation entries when below threshold", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 5 },
				coverage: {
					totals: { lines: 70, branches: 60, functions: 90, statements: 70 },
					thresholds: {
						global: { lines: 80, branches: 80 },
						patterns: [],
					},
					scoped: false,
					lowCoverage: [
						{
							file: "src/parser.ts",
							summary: { lines: 30, branches: 40, functions: 10, statements: 30 },
							uncoveredLines: "12-18",
						},
					],
					lowCoverageFiles: ["src/parser.ts"],
				},
			}),
		);
		const tags = events.map((e) => e._tag);
		expect(tags).toContain("CoverageReady");
		const violations = events.filter((e) => e._tag === "ThresholdViolation");
		expect(violations).toHaveLength(2);
		expect(violations.map((v) => v._tag === "ThresholdViolation" && v.metric)).toEqual(["lines", "branches"]);
	});

	it("omits ThresholdViolation when every metric is at or above threshold", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				coverage: {
					totals: { lines: 95, branches: 95, functions: 95, statements: 95 },
					thresholds: { global: { lines: 80, branches: 80 }, patterns: [] },
					scoped: false,
					lowCoverage: [],
					lowCoverageFiles: [],
				},
			}),
		);
		expect(events.some((e) => e._tag === "ThresholdViolation")).toBe(false);
	});
});

describe("synthesizeFromAgentReport — classifications", () => {
	it("emits FailureClassified for failed tests with classification set on TestReport", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "a.test.ts",
						state: "failed",
						tests: [
							{
								name: "broken",
								fullName: "broken",
								state: "failed",
								classification: "flaky",
							},
						],
					},
				],
			}),
		);
		const classified = events.find((e) => e._tag === "FailureClassified");
		expect(classified).toMatchObject({ testName: "broken", classification: "flaky" });
	});
});

describe("synthesizeFromAgentReport — end-to-end render", () => {
	it("folds through reducer and produces sensible agent output", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 4, passed: 2, failed: 1, skipped: 1, duration: 100 },
				failed: [
					{
						file: "src/math.test.ts",
						state: "failed",
						duration: 14,
						tests: [
							{
								name: "divides",
								fullName: "math > divides",
								state: "failed",
								duration: 7,
								errors: [{ message: "expected 0.5 to equal 0.5000001", diff: "- 0.5000001\n+ 0.5" }],
								classification: "new-failure",
							},
						],
					},
				],
				failedFiles: ["src/math.test.ts"],
			}),
		);
		const state = reduceRenderStateAll(events);
		const output = renderAgent(state);
		expect(output).toContain("Tests: 2/4 passed, 1 failed, 1 skipped (100ms)");
		expect(output).toContain("Failures:");
		expect(output).toContain("[new-failure]");
		expect(output).toContain("expected 0.5 to equal 0.5000001");
	});

	it("is deterministic across repeat calls", () => {
		const report = baseReport({
			summary: { total: 4, passed: 2, failed: 1, skipped: 1, duration: 100 },
			failed: [
				{
					file: "a.test.ts",
					state: "failed",
					tests: [{ name: "x", fullName: "x", state: "failed" }],
				},
			],
		});
		const first = synthesizeFromAgentReport(report);
		const second = synthesizeFromAgentReport(report);
		expect(first).toEqual(second);
	});
});

describe("synthesizeFromAgentReport — timeout detection", () => {
	it("sets timedOut: true on TestFinished for a Vitest timeout error message", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "slow.test.ts",
						state: "failed",
						tests: [
							{
								name: "waits forever",
								fullName: "waits forever",
								state: "failed",
								errors: [{ message: "Test timed out in 5000ms." }],
							},
						],
					},
				],
			}),
		);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).toMatchObject({ timedOut: true });
	});

	it("sets ModuleFinished.timeoutCount > 0 when a failing test timed out", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "slow.test.ts",
						state: "failed",
						tests: [
							{
								name: "waits forever",
								fullName: "waits forever",
								state: "failed",
								errors: [{ message: "Test timed out in 5000ms." }],
							},
						],
					},
				],
			}),
		);
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		// The timed-out test counts in timeoutCount only, NOT failCount —
		// mirroring the live reporter so the ✗ / ⧖ columns match.
		expect(moduleFinished).toMatchObject({ timeoutCount: 1, failCount: 0 });
	});

	it("sets RunFinished.timeoutCount when a test timed out", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "slow.test.ts",
						state: "failed",
						tests: [
							{
								name: "waits forever",
								fullName: "waits forever",
								state: "failed",
								errors: [{ message: "Test timed out in 10000ms." }],
							},
						],
					},
				],
			}),
		);
		const runFinished = events.find((e) => e._tag === "RunFinished");
		expect(runFinished).toMatchObject({ timeoutCount: 1 });
	});

	it("does not set timedOut on ordinary assertion failures", () => {
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 5 },
				failed: [
					{
						file: "a.test.ts",
						state: "failed",
						tests: [
							{
								name: "broken",
								fullName: "broken",
								state: "failed",
								errors: [{ message: "expected 1 to equal 2" }],
							},
						],
					},
				],
			}),
		);
		const finished = events.find((e) => e._tag === "TestFinished");
		expect(finished).not.toMatchObject({ timedOut: true });
		const moduleFinished = events.find((e) => e._tag === "ModuleFinished");
		expect(moduleFinished).not.toMatchObject({ timeoutCount: expect.any(Number) });
	});
});

describe("synthesizeFromAgentReport — tagCounts omitted on replay", () => {
	it("does not attach run-level tagCounts to ModuleFinished (would over-count across modules)", () => {
		// AgentReport carries only run-level tagCounts. Attaching them to each
		// failed module multiplied every per-tag total by the number of failed
		// modules in the workspace rollup (mergeTagCounts sums each module), so
		// the replay path omits per-module tagCounts entirely. With two failed
		// modules, neither ModuleFinished carries a tagCounts field.
		const events = synthesizeFromAgentReport(
			baseReport({
				summary: { total: 2, passed: 0, failed: 2, skipped: 0, duration: 10 },
				tagCounts: { unit: { passed: 2, failed: 1 }, int: { passed: 2 } },
				failed: [
					{
						file: "a.test.ts",
						state: "failed",
						tests: [{ name: "x", fullName: "x", state: "failed" }],
					},
					{
						file: "b.test.ts",
						state: "failed",
						tests: [{ name: "y", fullName: "y", state: "failed" }],
					},
				],
			}),
		);
		const moduleFinished = events.filter((e) => e._tag === "ModuleFinished");
		expect(moduleFinished).toHaveLength(2);
		for (const m of moduleFinished) {
			expect(m).not.toHaveProperty("tagCounts");
		}
	});
});

describe("synthesizeFromAgentReport — suite-level (collection/load) failures", () => {
	// A module that failed to import lands in `report.failed` with no failed
	// test case (allTests was empty) and `summary.failed` stays 0. The
	// synthesizer must surface it so the run does not render all-green.
	const collectionFailureReport = (): AgentReport =>
		baseReport({
			reason: "failed",
			// summary stays pure — the load failure is NOT a test case
			summary: { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 },
			failed: [
				{
					file: "src/broken.test.ts",
					state: "failed",
					duration: 0,
					tests: [],
					errors: [{ message: "Cannot find package 'better-sqlite3'" }],
				},
			],
			failedFiles: ["src/broken.test.ts"],
		});

	it("emits a synthetic failed test carrying the module's import error", () => {
		const events = synthesizeFromAgentReport(collectionFailureReport());
		const testFinished = events.filter((e) => e._tag === "TestFinished");
		expect(testFinished).toHaveLength(1);
		const tf = testFinished[0] as Extract<(typeof events)[number], { _tag: "TestFinished" }>;
		expect(tf.modulePath).toBe("src/broken.test.ts");
		expect(tf.testName).toBe(SUITE_LOAD_FAILURE_LABEL);
		expect(tf.status).toBe("failed");
		expect(tf.error?.message).toContain("Cannot find package 'better-sqlite3'");
	});

	it("counts the load failure in the run totals so the outcome is a failure", () => {
		const events = synthesizeFromAgentReport(collectionFailureReport());
		const runFinished = events.find((e) => e._tag === "RunFinished") as Extract<
			(typeof events)[number],
			{ _tag: "RunFinished" }
		>;
		// summary.failed is 0, but the RunFinished total counts the suite failure
		expect(runFinished.failCount).toBe(1);
	});

	it("reduces to a RenderState with the failure named and counted", () => {
		const state = reduceRenderStateAll(synthesizeFromAgentReport(collectionFailureReport()));
		expect(state.totals.failCount).toBe(1);
		expect(state.failures).toHaveLength(1);
		expect(state.failures[0].modulePath).toBe("src/broken.test.ts");
		expect(state.failures[0].testName).toBe(SUITE_LOAD_FAILURE_LABEL);
		expect(state.failures[0].error?.message).toContain("Cannot find package 'better-sqlite3'");
	});

	it("renders the failed file and its error in the agent Failures section", () => {
		const state = reduceRenderStateAll(synthesizeFromAgentReport(collectionFailureReport()));
		const out = renderAgent(state);
		expect(out).toContain("src/broken.test.ts");
		expect(out).toContain(SUITE_LOAD_FAILURE_LABEL);
		expect(out).toContain("Cannot find package 'better-sqlite3'");
	});
});
