import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CoverageBaselines } from "../src/schemas/Baselines.js";

describe("CoverageBaselines", () => {
	it("decodes valid baselines", () => {
		const input = {
			updatedAt: "2026-03-22T12:00:00.000Z",
			global: { lines: 82.5, functions: 78 },
			patterns: [["src/utils/**.ts", { lines: 90 }]],
		};
		const result = Schema.decodeUnknownSync(CoverageBaselines)(input);
		expect(result.global.lines).toBe(82.5);
		expect(result.patterns[0][0]).toBe("src/utils/**.ts");
	});

	it("defaults patterns to empty array", () => {
		const input = {
			updatedAt: "2026-03-22T12:00:00.000Z",
			global: { lines: 80 },
		};
		const result = Schema.decodeUnknownSync(CoverageBaselines)(input);
		expect(result.patterns).toEqual([]);
	});

	it("rejects missing updatedAt", () => {
		const input = { global: { lines: 80 } };
		expect(() => Schema.decodeUnknownSync(CoverageBaselines)(input)).toThrow();
	});
});
