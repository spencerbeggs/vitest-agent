/**
 * vitest-agent-sdk
 *
 * Tests for formatGfm().
 */

import { describe, expect, it } from "vitest";
import type { AgentReport } from "../src/schemas/AgentReport.js";
import { formatGfm } from "../src/utils/format-gfm.js";

// --- Test Fixtures ---

const passingReport: AgentReport = {
	timestamp: "2026-03-20T00:00:00.000Z",
	project: "core:unit",
	reason: "passed",
	summary: { total: 10, passed: 10, failed: 0, skipped: 0, duration: 200 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
};

const failingReport: AgentReport = {
	timestamp: "2026-03-20T00:00:00.000Z",
	project: "api:unit",
	reason: "failed",
	summary: { total: 8, passed: 6, failed: 2, skipped: 0, duration: 350 },
	failed: [
		{
			file: "src/api/handler.test.ts",
			state: "failed",
			duration: 45,
			tests: [
				{
					name: "returns 404",
					fullName: "Handler > returns 404",
					state: "failed",
					duration: 10,
					errors: [{ message: "expected 404, got 500", diff: "- 404\n+ 500" }],
				},
			],
		},
	],
	unhandledErrors: [],
	failedFiles: ["src/api/handler.test.ts"],
};

const reportWithCoverage: AgentReport = {
	...passingReport,
	coverage: {
		totals: { statements: 85, branches: 78, functions: 90, lines: 82 },
		thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
		scoped: false,
		lowCoverage: [
			{
				file: "src/auth/session.ts",
				summary: { statements: 45, branches: 30, functions: 50, lines: 40 },
				uncoveredLines: "42-50,99",
			},
		],
		lowCoverageFiles: ["src/auth/session.ts"],
	},
};

// --- Tests ---

describe("formatGfm", () => {
	it("single passing report contains header and summary with correct counts", () => {
		const result = formatGfm([passingReport]);
		expect(result).toContain("Vitest Results");
		expect(result).toContain("Passed");
		expect(result).toContain("**10**");
	});

	it("single passing report uses checkmark icon in header", () => {
		const result = formatGfm([passingReport]);
		expect(result).toContain("\u2705");
	});

	it("single failing report uses X icon in header", () => {
		const result = formatGfm([failingReport]);
		expect(result).toContain("\u274C");
	});

	it("single failing report contains test name, error message, and diff block", () => {
		const result = formatGfm([failingReport]);
		expect(result).toContain("Handler > returns 404");
		expect(result).toContain("expected 404, got 500");
		expect(result).toContain("```diff");
		expect(result).toContain("- 404");
		expect(result).toContain("+ 500");
	});

	it("single failing report contains file heading", () => {
		const result = formatGfm([failingReport]);
		expect(result).toContain("src/api/handler.test.ts");
	});

	it("single project does not use details wrapper", () => {
		const result = formatGfm([passingReport]);
		expect(result).not.toContain("<details>");
		expect(result).not.toContain("<summary>");
		expect(result).not.toContain("</details>");
	});

	it("multiple projects use details wrapper with both project names", () => {
		const result = formatGfm([passingReport, failingReport]);
		expect(result).toContain("<details>");
		expect(result).toContain("<summary>");
		expect(result).toContain("</details>");
		expect(result).toContain("core:unit");
		expect(result).toContain("api:unit");
	});

	it("multiple projects summary totals aggregate across all reports", () => {
		const result = formatGfm([passingReport, failingReport]);
		// total: 10 + 8 = 18, passed: 10 + 6 = 16, failed: 0 + 2 = 2
		expect(result).toContain("**18**");
		expect(result).toContain("**16**");
		expect(result).toContain("**2**");
	});

	it("coverage table is present when coverage data exists", () => {
		const result = formatGfm([reportWithCoverage]);
		expect(result).toContain("Coverage");
		expect(result).toContain("85%");
		expect(result).toContain("78%");
		expect(result).toContain("90%");
		expect(result).toContain("82%");
	});

	it("low coverage warning uses [!WARNING] alert with file name", () => {
		const result = formatGfm([reportWithCoverage]);
		expect(result).toContain("[!WARNING]");
		expect(result).toContain("src/auth/session.ts");
	});

	it("report without coverage has no coverage section", () => {
		const result = formatGfm([passingReport]);
		expect(result).not.toContain("## Coverage");
	});

	it("summary table contains Passed, Failed, and Total rows", () => {
		const result = formatGfm([passingReport]);
		expect(result).toContain("Passed");
		expect(result).toContain("Failed");
		expect(result).toContain("Total");
	});

	it("error message is in a blockquote", () => {
		const result = formatGfm([failingReport]);
		expect(result).toContain("> expected 404, got 500");
	});

	it("renders module-level errors with diffs", () => {
		const reportWithModuleErrors: AgentReport = {
			timestamp: "2026-03-20T00:00:00.000Z",
			reason: "failed",
			summary: { total: 2, passed: 0, failed: 2, skipped: 0, duration: 100 },
			failed: [
				{
					file: "src/broken.test.ts",
					state: "failed",
					duration: 50,
					errors: [
						{
							message: "Module syntax error",
							diff: "- expected\n+ received",
						},
					],
					tests: [
						{
							name: "test one",
							fullName: "Broken > test one",
							state: "failed",
							duration: 10,
							errors: [{ message: "test error" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/broken.test.ts"],
		};

		const result = formatGfm([reportWithModuleErrors]);
		expect(result).toContain("Module syntax error");
		expect(result).toContain("```diff");
		expect(result).toContain("- expected");
		expect(result).toContain("+ received");
	});

	it("renders module-level errors without diffs", () => {
		const reportWithModuleErrorsNoDiff: AgentReport = {
			timestamp: "2026-03-20T00:00:00.000Z",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
			failed: [
				{
					file: "src/syntax.test.ts",
					state: "failed",
					duration: 10,
					errors: [{ message: "Cannot find module" }],
					tests: [
						{
							name: "a test",
							fullName: "Syntax > a test",
							state: "failed",
							duration: 5,
							errors: [{ message: "boom" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/syntax.test.ts"],
		};

		const result = formatGfm([reportWithModuleErrorsNoDiff]);
		expect(result).toContain("> Cannot find module");
		// Should NOT have diff block for this error
		const lines = result.split("\n");
		const moduleErrorIdx = lines.findIndex((l) => l.includes("Cannot find module"));
		// The next non-empty line should not be ```diff
		const nextNonEmpty = lines.slice(moduleErrorIdx + 1).find((l) => l.trim() !== "");
		expect(nextNonEmpty).not.toBe("```diff");
	});

	it("multi-project uses 'default' label when project is undefined", () => {
		const noProjectName: AgentReport = {
			timestamp: "2026-03-20T00:00:00.000Z",
			reason: "passed",
			summary: { total: 5, passed: 5, failed: 0, skipped: 0, duration: 100 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		};

		const result = formatGfm([noProjectName, passingReport]);
		expect(result).toContain("default");
		expect(result).toContain("core:unit");
	});

	it("multi-project shows status icons per project", () => {
		const result = formatGfm([passingReport, failingReport]);
		// passingReport should have checkmark, failingReport should have X
		const lines = result.split("\n");
		const summaryLines = lines.filter((l) => l.includes("<summary>"));
		expect(summaryLines).toHaveLength(2);
		expect(summaryLines.some((l) => l.includes("\u2705") && l.includes("core:unit"))).toBe(true);
		expect(summaryLines.some((l) => l.includes("\u274C") && l.includes("api:unit"))).toBe(true);
	});

	it("empty reports array produces header only", () => {
		const result = formatGfm([]);
		expect(result).toContain("Vitest Results");
		expect(result).toContain("**0**");
	});
});
