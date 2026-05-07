import { describe, expect, it } from "vitest";
import { formatTrends } from "../src/lib/format-trends.js";

describe("formatTrends", () => {
	it("shows message when no data", () => {
		const output = formatTrends([]);
		expect(output).toContain("No trend data");
	});

	it("formats single project trends", () => {
		const output = formatTrends([
			{
				project: "default",
				trends: {
					entries: [
						{
							timestamp: "t1",
							coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
							delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
							direction: "stable",
						},
						{
							timestamp: "t2",
							coverage: { lines: 82, functions: 72, branches: 62, statements: 77 },
							delta: { lines: 2, functions: 2, branches: 2, statements: 2 },
							direction: "improving",
						},
					],
				},
			},
		]);
		expect(output).toContain("### default");
		expect(output).toContain("Direction: improving");
		expect(output).toContain("80.0 -> 82.0 (lines)");
	});

	it("shows target columns when targets configured", () => {
		const output = formatTrends([
			{
				project: "default",
				trends: {
					entries: [
						{
							timestamp: "t1",
							coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
							delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
							direction: "stable",
						},
					],
				},
				targets: { global: { lines: 90 }, perFile: false, patterns: [] },
			},
		]);
		expect(output).toContain("Target");
		expect(output).toContain("Gap");
		expect(output).toContain("90%");
	});

	it("omits target columns when no targets", () => {
		const output = formatTrends([
			{
				project: "default",
				trends: {
					entries: [
						{
							timestamp: "t1",
							coverage: { lines: 80, functions: 70, branches: 60, statements: 75 },
							delta: { lines: 0, functions: 0, branches: 0, statements: 0 },
							direction: "stable",
						},
					],
				},
			},
		]);
		expect(output).not.toContain("Target");
		expect(output).not.toContain("Gap");
	});
});
