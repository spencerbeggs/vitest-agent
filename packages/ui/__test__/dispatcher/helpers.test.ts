import type { FileCoverageReport, RenderState } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { formatBelowTargetTable, formatTotals } from "../../src/dispatcher/helpers.js";

const baseState = (overrides: Partial<RenderState> = {}): RenderState => ({
	...initialRenderState,
	phase: "finished",
	...overrides,
});

describe("formatTotals", () => {
	it("omits timed out when timeoutCount is zero", () => {
		const state = baseState({
			totals: { passCount: 5, failCount: 0, skipCount: 0, timeoutCount: 0, durationMs: 42 },
		});
		expect(formatTotals(state)).toBe("Tests: 5/5 passed (42ms)");
	});

	it("folds timeoutCount into the total and adds a 'timed out' part for a timeout-only run (issue #224)", () => {
		const state = baseState({
			totals: { passCount: 0, failCount: 0, skipCount: 0, timeoutCount: 1, durationMs: 5000 },
		});
		expect(formatTotals(state)).toBe("Tests: 0/1 passed, 1 timed out (5s)");
	});

	it("shows failed, timed out, and skipped together in that order when all are nonzero", () => {
		const state = baseState({
			totals: { passCount: 2, failCount: 1, skipCount: 3, timeoutCount: 1, durationMs: 100 },
		});
		expect(formatTotals(state)).toBe("Tests: 2/7 passed, 1 failed, 1 timed out, 3 skipped (100ms)");
	});
});

describe("formatBelowTargetTable", () => {
	const fileReport = (file: string): FileCoverageReport => ({
		file,
		summary: { statements: 50, branches: 50, functions: 50, lines: 50 },
		uncoveredLines: "1-10",
	});

	it("does not truncate a file path longer than the 60-char default column width (issue #237 follow-up)", () => {
		const longPath = "packages/some-really-long-workspace-name/src/deeply/nested/directory/structure/module.ts";
		const rows = formatBelowTargetTable([fileReport(longPath)], 10);
		expect(rows.join("\n")).toContain(longPath);
		expect(rows.join("\n")).not.toContain("…");
	});
});
