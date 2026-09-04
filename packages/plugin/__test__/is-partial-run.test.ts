import { describe, expect, it } from "vitest";
import { isPartialRun } from "../src/utils/is-partial-run.js";

describe("isPartialRun", () => {
	it("returns false for a full run: no filenamePattern, matching spec counts, no projectFilter", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 10,
			totalSpecCount: 10,
			projectFilter: undefined,
		});
		expect(result).toBe(false);
	});
});
