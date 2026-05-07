import { describe, expect, it } from "vitest";
import { compressLines } from "../src/utils/compress-lines.js";

describe("compressLines", () => {
	it("compresses mixed consecutive and non-consecutive lines", () => {
		expect(compressLines([1, 2, 3, 5, 10, 11, 12])).toBe("1-3,5,10-12");
	});

	it("returns non-consecutive lines as comma-separated", () => {
		expect(compressLines([1, 3, 5])).toBe("1,3,5");
	});

	it("returns empty string for empty array", () => {
		expect(compressLines([])).toBe("");
	});

	it("returns single line number as string", () => {
		expect(compressLines([42])).toBe("42");
	});

	it("compresses all-consecutive lines into a single range", () => {
		expect(compressLines([1, 2, 3, 4, 5])).toBe("1-5");
	});

	it("compresses two-element range", () => {
		expect(compressLines([1, 2])).toBe("1-2");
	});

	it("sorts unsorted input before compressing", () => {
		expect(compressLines([5, 1, 3, 2, 4])).toBe("1-5");
	});

	it("deduplicates before compressing", () => {
		expect(compressLines([1, 1, 2, 2, 3])).toBe("1-3");
	});
});
