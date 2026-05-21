import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RenderState, initialRenderState } from "../src/schemas/RenderState.js";

describe("RenderState — stream-mode-states additions", () => {
	it("initialRenderState carries a zero timeoutCount and a null trend", () => {
		expect(initialRenderState.totals.timeoutCount).toBe(0);
		expect(initialRenderState.trend).toBeNull();
	});

	it("decodes a state with a timed-out test and a trend", () => {
		const decoded = Schema.decodeUnknownSync(RenderState)({
			...initialRenderState,
			trend: { direction: "stable", runCount: 3 },
			modules: {
				"a.test.ts": {
					modulePath: "a.test.ts",
					status: "finished",
					passCount: 1,
					failCount: 0,
					skipCount: 0,
					timeoutCount: 1,
					durationMs: 5,
					tests: [{ testName: "t", suitePath: [], status: "timed-out", durationMs: null }],
				},
			},
		});
		expect(decoded.trend?.direction).toBe("stable");
		expect(decoded.modules["a.test.ts"]?.timeoutCount).toBe(1);
	});
});
