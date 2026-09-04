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

	it("returns true when filenamePattern is a non-empty array", () => {
		const result = isPartialRun({
			filenamePattern: ["src/foo.test.ts"],
			startedSpecCount: 1,
			totalSpecCount: 10,
			projectFilter: undefined,
		});
		expect(result).toBe(true);
	});

	it("returns true when startedSpecCount is less than totalSpecCount", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 3,
			totalSpecCount: 10,
			projectFilter: undefined,
		});
		expect(result).toBe(true);
	});

	it("returns true when projectFilter is set even if spec counts match", () => {
		const result = isPartialRun({
			filenamePattern: undefined,
			startedSpecCount: 10,
			totalSpecCount: 10,
			projectFilter: "sdk",
		});
		expect(result).toBe(true);
	});
});
