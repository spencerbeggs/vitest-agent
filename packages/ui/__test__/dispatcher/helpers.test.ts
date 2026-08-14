import type { RenderState } from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { formatTotals } from "../../src/dispatcher/helpers.js";

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
