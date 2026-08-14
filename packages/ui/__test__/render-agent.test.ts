import type { RenderState } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { renderAgent } from "../src/index.js";

const baseState = (overrides: Partial<RenderState> = {}): RenderState => ({
	...initialRenderState,
	phase: "finished",
	...overrides,
});

describe("renderAgent — header", () => {
	it("warns instead of rendering a bare header when nothing was collected", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 0 },
		});
		expect(renderAgent(state)).toMatchInlineSnapshot(`
			"Tests: 0/0 passed (0ms)

			0 tests collected. A zero-test run usually means a wrong working directory, a filter that matched nothing, or a load-time error — verify before trusting it.
			"
		`);
	});

	it("includes failed and skipped counts when nonzero", () => {
		const state = baseState({
			totals: { passCount: 2, failCount: 1, skipCount: 3, timeoutCount: 0, durationMs: 100 },
		});
		const output = renderAgent(state);
		expect(output.split("\n")[0]).toBe("Tests: 2/6 passed, 1 failed, 3 skipped (100ms)");
	});

	it("omits failed and skipped when zero", () => {
		const state = baseState({
			totals: { passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 42 },
		});
		expect(renderAgent(state).split("\n")[0]).toBe("Tests: 5/5 passed (42ms)");
	});

	it("folds timeoutCount into the total and adds a 'timed out' part for a timeout-only run (issue #224)", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 1, durationMs: 5000 },
		});
		expect(renderAgent(state).split("\n")[0]).toBe("Tests: 0/1 passed, 1 timed out (5s)");
	});

	it("shows both failed and timed out counts, folded into the same total, when both are present", () => {
		const state = baseState({
			totals: { passCount: 2, failCount: 1, skipCount: 0, timeoutCount: 1, durationMs: 100 },
		});
		expect(renderAgent(state).split("\n")[0]).toBe("Tests: 2/4 passed, 1 failed, 1 timed out (100ms)");
	});
});

describe("renderAgent — modules", () => {
	it("collapses to N modules all-passed when nothing fails or skips", () => {
		const state = baseState({
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 3,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 10,
					tests: [],
				},
				"b.test.ts": {
					modulePath: "b.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 5,
					tests: [],
				},
			},
			moduleOrder: ["a.test.ts", "b.test.ts"],
			totals: { passCount: 4, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 15 },
		});
		expect(renderAgent(state)).toMatchInlineSnapshot(`
			"Tests: 4/4 passed (15ms)

			2 modules all-passed.
			"
		`);
	});

	it("uses singular noun for one module", () => {
		const state = baseState({
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 5,
					tests: [],
				},
			},
			moduleOrder: ["a.test.ts"],
			totals: { passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 5 },
		});
		expect(renderAgent(state).split("\n").slice(2).join("\n")).toBe("1 module all-passed.\n");
	});

	it("lists every module when any has failures or skips", () => {
		const state = baseState({
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 2,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 10,
					tests: [],
				},
				"b.test.ts": {
					modulePath: "b.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 1,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 8,
					tests: [],
				},
			},
			moduleOrder: ["a.test.ts", "b.test.ts"],
			totals: { passCount: 3, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 18 },
		});
		const output = renderAgent(state);
		expect(output).toContain("Modules:");
		expect(output).toContain("- a.test.ts: 2 passed");
		expect(output).toContain("- b.test.ts: 1 passed, 1 failed");
	});

	it("renders the true module count on a green run (issue #204)", () => {
		const state = baseState({
			totals: { passCount: 59, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 500 },
			collectedModules: 3,
		});
		const out = renderAgent(state);
		expect(out).toContain("3 modules all-passed.");
		expect(out).not.toContain("0 modules");
	});

	it("warns instead of celebrating a zero-collected run (issue #192)", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 0 },
			collectedModules: 0,
		});
		const out = renderAgent(state);
		expect(out).toContain("0 tests collected");
		expect(out).not.toContain("all-passed");
	});

	it("does not print the zero-collected warning for a timeout-only run", () => {
		// Parity with the single-project-pass cell: a timed-out test is a
		// real collected test even though pass=fail=skip=0.
		const state = baseState({
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 1, durationMs: 50 },
			collectedModules: 1,
		});
		const out = renderAgent(state);
		expect(out).not.toContain("0 tests collected");
	});
});

describe("renderAgent — failures block", () => {
	it("omits the failures block when there are no failures", () => {
		const state = baseState({
			totals: { passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 5 },
		});
		expect(renderAgent(state)).not.toContain("Failures:");
	});

	it("renders one failure with classification, message, and diff", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 7 },
			failures: [
				{
					modulePath: "src/math.test.ts",
					testName: "divides",
					suitePath: ["math"],
					classification: "new-failure",
					error: {
						message: "expected 0.5 to equal 0.5000001",
						diff: "- 0.5000001\n+ 0.5",
					},
				},
			],
		});
		expect(renderAgent(state)).toMatchInlineSnapshot(`
			"Tests: 0/1 passed, 1 failed (7ms)

			Failures:
			- src/math.test.ts > math > divides [new-failure]
			  expected 0.5 to equal 0.5000001
			  - 0.5000001
			  + 0.5
			"
		`);
	});

	it("renders unclassified failures without the trailing tag", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 1 },
			failures: [
				{
					modulePath: "src/a.test.ts",
					testName: "t",
					suitePath: [],
					classification: null,
				},
			],
		});
		expect(renderAgent(state)).toContain("- src/a.test.ts > t\n");
	});

	it("includes the stack trace when includeStack is true", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 1, skipCount: 0, timeoutCount: 0, durationMs: 1 },
			failures: [
				{
					modulePath: "src/a.test.ts",
					testName: "t",
					suitePath: [],
					classification: null,
					error: { message: "boom", stack: "Error\n    at fn (src/a.ts:1:1)" },
				},
			],
		});
		const output = renderAgent(state, { includeStack: true });
		expect(output).toContain("at fn (src/a.ts:1:1)");
	});
});

describe("renderAgent — coverage block", () => {
	it("omits the coverage block when state.coverage is null", () => {
		expect(renderAgent(baseState())).not.toContain("Coverage:");
	});

	it("renders metrics, violations, and a single gap with line ranges", () => {
		const state = baseState({
			totals: { passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 10 },
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 10,
					tests: [],
				},
			},
			moduleOrder: ["a.test.ts"],
			coverage: {
				metrics: { lines: 72.5, branches: 60, functions: 85, statements: 72 },
				thresholds: { lines: 80, branches: 80 },
				gaps: [
					{
						file: "src/parser.ts",
						missing: { lines: 30, branches: 40, functions: 0, statements: 30 },
						uncoveredLines: "12-18, 22",
					},
				],
				violations: [
					{ metric: "lines", expected: 80, actual: 72.5 },
					{ metric: "branches", expected: 80, actual: 60 },
				],
			},
		});
		expect(renderAgent(state)).toMatchInlineSnapshot(`
			"Tests: 1/1 passed (10ms)

			1 module all-passed.

			Coverage:
			- lines: 72.5% (threshold 80%)
			- branches: 60% (threshold 80%)
			- functions: 85%
			- statements: 72%
			Violations:
			- lines: 72.5% < 80%
			- branches: 60% < 80%
			Gaps:
			- src/parser.ts: 12-18, 22
			"
		`);
	});

	it("caps gaps at maxCoverageGaps and notes how many were elided", () => {
		const state = baseState({
			coverage: {
				metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
				thresholds: {},
				violations: [],
				gaps: [
					{ file: "a.ts", missing: { lines: 50, branches: 0, functions: 0, statements: 0 } },
					{ file: "b.ts", missing: { lines: 40, branches: 0, functions: 0, statements: 0 } },
					{ file: "c.ts", missing: { lines: 30, branches: 0, functions: 0, statements: 0 } },
					{ file: "d.ts", missing: { lines: 20, branches: 0, functions: 0, statements: 0 } },
					{ file: "e.ts", missing: { lines: 10, branches: 0, functions: 0, statements: 0 } },
				],
			},
		});
		const output = renderAgent(state, { maxCoverageGaps: 2 });
		expect(output).toContain("- a.ts");
		expect(output).toContain("- b.ts");
		expect(output).not.toContain("- c.ts");
		expect(output).toContain("(+3 more gaps)");
	});

	it("omits gaps when maxCoverageGaps is 0", () => {
		const state = baseState({
			coverage: {
				metrics: { lines: 90, branches: 90, functions: 90, statements: 90 },
				thresholds: {},
				violations: [],
				gaps: [{ file: "a.ts", missing: { lines: 1, branches: 0, functions: 0, statements: 0 } }],
			},
		});
		expect(renderAgent(state, { maxCoverageGaps: 0 })).not.toContain("Gaps:");
	});
});

describe("renderAgent — actions block", () => {
	it("omits the actions block when there are none", () => {
		expect(renderAgent(baseState())).not.toContain("Actions:");
	});

	it("renders all three severities with optional tool hint", () => {
		const state = baseState({
			totals: { passCount: 2, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 5 },
			suggestedActions: [
				{ severity: "info", title: "a", detail: "alpha detail" },
				{ severity: "warn", title: "b", detail: "beta detail", targetTool: "run_tests" },
				{ severity: "blocker", title: "c", detail: "gamma detail" },
			],
		});
		expect(renderAgent(state)).toMatchInlineSnapshot(`
			"Tests: 2/2 passed (5ms)

			Actions:
			- info: a
			  alpha detail
			- warn: b (tool: run_tests)
			  beta detail
			- blocker: c
			  gamma detail
			"
		`);
	});
});

describe("renderAgent — determinism", () => {
	it("produces byte-identical output for the same state", () => {
		const state = baseState({
			totals: { passCount: 1, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 7 },
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 0,
					durationMs: 7,
					tests: [],
				},
			},
			moduleOrder: ["a.test.ts"],
		});
		const a = renderAgent(state);
		const b = renderAgent(state);
		expect(a).toBe(b);
	});
});
