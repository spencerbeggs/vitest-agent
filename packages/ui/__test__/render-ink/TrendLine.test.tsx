import { describe, expect, it } from "vitest";
import { TrendLine } from "../../src/render-ink/TrendLine.js";
import { renderInk } from "../utils/render-ink.js";

describe("TrendLine", () => {
	it("renders the direction and a pluralized run count", () => {
		const { frame, cleanup } = renderInk(<TrendLine trend={{ direction: "regressing", runCount: 5 }} />, 80);
		expect(frame).toBe("Trend: regressing (5 runs)");
		cleanup();
	});

	it("uses the singular for a single run", () => {
		const { frame, cleanup } = renderInk(<TrendLine trend={{ direction: "stable", runCount: 1 }} />, 80);
		expect(frame).toBe("Trend: stable (1 run)");
		cleanup();
	});
});
