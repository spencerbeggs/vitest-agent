import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TrendEntry, TrendRecord } from "../src/schemas/Trends.js";

describe("TrendEntry", () => {
	it("decodes a valid entry", () => {
		const input = {
			timestamp: "2026-03-22T12:00:00.000Z",
			coverage: { lines: 87.3, functions: 82.1, branches: 75.0, statements: 80.1 },
			delta: { lines: 0.8, functions: 0.5, branches: 0.0, statements: 0.3 },
			direction: "improving",
			targetsHash: "a1b2c3",
		};
		const result = Schema.decodeUnknownSync(TrendEntry)(input);
		expect(result.direction).toBe("improving");
		expect(result.coverage.lines).toBe(87.3);
	});

	it("accepts entry without targetsHash", () => {
		const input = {
			timestamp: "2026-03-22T12:00:00.000Z",
			coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
			delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
			direction: "stable",
		};
		const result = Schema.decodeUnknownSync(TrendEntry)(input);
		expect(result.targetsHash).toBeUndefined();
	});

	it("rejects invalid direction", () => {
		const input = {
			timestamp: "2026-03-22T12:00:00.000Z",
			coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
			delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
			direction: "unknown",
		};
		expect(() => Schema.decodeUnknownSync(TrendEntry)(input)).toThrow();
	});
});

describe("TrendRecord", () => {
	it("decodes a record with entries", () => {
		const input = {
			entries: [
				{
					timestamp: "2026-03-22T12:00:00.000Z",
					coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
					delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
					direction: "stable",
				},
			],
		};
		const result = Schema.decodeUnknownSync(TrendRecord)(input);
		expect(result.entries).toHaveLength(1);
	});

	it("decodes empty entries", () => {
		const result = Schema.decodeUnknownSync(TrendRecord)({ entries: [] });
		expect(result.entries).toEqual([]);
	});
});
