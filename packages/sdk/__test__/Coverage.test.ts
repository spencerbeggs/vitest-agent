import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CoverageReport, CoverageTotals, FileCoverageReport } from "../src/schemas/Coverage.js";

describe("CoverageTotals", () => {
	it("accepts valid totals", () => {
		const input = { statements: 90, branches: 85, functions: 88, lines: 91 };
		const result = Schema.decodeUnknownSync(CoverageTotals)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing fields", () => {
		expect(() => Schema.decodeUnknownSync(CoverageTotals)({ statements: 90 })).toThrow();
	});

	it("rejects non-number fields", () => {
		expect(() =>
			Schema.decodeUnknownSync(CoverageTotals)({
				statements: "90",
				branches: 85,
				functions: 88,
				lines: 91,
			}),
		).toThrow();
	});
});

describe("FileCoverageReport", () => {
	it("accepts a valid file coverage report", () => {
		const input = {
			file: "src/utils.ts",
			summary: { statements: 45, branches: 30, functions: 50, lines: 45 },
			uncoveredLines: "42-50,99,120-135",
		};
		const result = Schema.decodeUnknownSync(FileCoverageReport)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing file field", () => {
		expect(() =>
			Schema.decodeUnknownSync(FileCoverageReport)({
				summary: { statements: 45, branches: 30, functions: 50, lines: 45 },
				uncoveredLines: "42-50",
			}),
		).toThrow();
	});
});

describe("CoverageReport", () => {
	const validReport = {
		totals: { statements: 90, branches: 85, functions: 88, lines: 91 },
		thresholds: { global: { lines: 80 }, patterns: [] },
		lowCoverage: [
			{
				file: "src/utils.ts",
				summary: { statements: 45, branches: 30, functions: 50, lines: 45 },
				uncoveredLines: "42-50,99",
			},
		],
		lowCoverageFiles: ["src/utils.ts"],
	};

	it("accepts a valid coverage report", () => {
		const result = Schema.decodeUnknownSync(CoverageReport)(validReport);
		expect(result).toEqual({ ...validReport, scoped: false });
	});

	it("defaults scoped to false when omitted", () => {
		const result = Schema.decodeUnknownSync(CoverageReport)(validReport);
		expect(result.scoped).toBe(false);
	});

	it("accepts scoped: true", () => {
		const input = { ...validReport, scoped: true, scopedFiles: ["src/utils.ts"] };
		const result = Schema.decodeUnknownSync(CoverageReport)(input);
		expect(result.scoped).toBe(true);
		expect(result.scopedFiles).toEqual(["src/utils.ts"]);
	});

	it("accepts empty arrays for lowCoverage and lowCoverageFiles", () => {
		const input = {
			totals: { statements: 100, branches: 100, functions: 100, lines: 100 },
			thresholds: { global: { lines: 80 }, patterns: [] },
			lowCoverage: [],
			lowCoverageFiles: [],
		};
		const result = Schema.decodeUnknownSync(CoverageReport)(input);
		expect(result.lowCoverage).toEqual([]);
		expect(result.lowCoverageFiles).toEqual([]);
	});

	it("rejects missing thresholds", () => {
		const { thresholds: _, ...noThresholds } = validReport;
		expect(() => Schema.decodeUnknownSync(CoverageReport)(noThresholds)).toThrow();
	});

	it("accepts targets field", () => {
		const input = {
			...validReport,
			targets: { global: { lines: 90 }, patterns: [] },
		};
		const result = Schema.decodeUnknownSync(CoverageReport)(input);
		expect(result.targets?.global.lines).toBe(90);
	});

	it("accepts baselines field", () => {
		const input = {
			...validReport,
			baselines: { global: { lines: 70 }, patterns: [] },
		};
		const result = Schema.decodeUnknownSync(CoverageReport)(input);
		expect(result.baselines?.global.lines).toBe(70);
	});

	it("defaults thresholds patterns to empty array", () => {
		const input = {
			...validReport,
			thresholds: { global: { lines: 80 } },
		};
		const result = Schema.decodeUnknownSync(CoverageReport)(input);
		expect(result.thresholds.patterns).toEqual([]);
	});
});
