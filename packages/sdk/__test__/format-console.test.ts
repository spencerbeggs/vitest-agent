/**
 * vitest-agent-sdk
 *
 * Tests for formatConsoleMarkdown() and getWorstMetric().
 */

import { describe, expect, it } from "vitest";
import type { AgentReport } from "../src/schemas/AgentReport.js";
import type { ConsoleFormatOptions } from "../src/utils/format-console.js";
import { determineTier, formatConsoleMarkdown, getWorstMetric, relativePath } from "../src/utils/format-console.js";

// --- Test Fixtures ---

const baseOptions: ConsoleFormatOptions = {
	consoleOutput: "failures",
	coverageConsoleLimit: 10,
	noColor: true,
};

const passingReport: AgentReport = {
	timestamp: "2024-01-01T00:00:00.000Z",
	reason: "passed",
	summary: { total: 5, passed: 5, failed: 0, skipped: 0, duration: 120.456 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
};

const failingReport: AgentReport = {
	timestamp: "2024-01-01T00:00:00.000Z",
	reason: "failed",
	summary: { total: 5, passed: 3, failed: 2, skipped: 0, duration: 250.789 },
	failed: [
		{
			file: "src/auth/login.test.ts",
			state: "failed",
			duration: 180,
			tests: [
				{
					name: "validates credentials",
					fullName: "Auth > validates credentials",
					state: "failed",
					duration: 90,
					errors: [{ message: "expected true to equal false", diff: "- true\n+ false" }],
				},
				{
					name: "rejects invalid token",
					fullName: "Auth > rejects invalid token",
					state: "failed",
					duration: 90,
					errors: [{ message: "expected 401 to equal 403" }],
				},
			],
		},
	],
	unhandledErrors: [],
	failedFiles: ["src/auth/login.test.ts"],
	coverage: {
		totals: { statements: 72, branches: 68, functions: 75, lines: 73 },
		thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
		scoped: false,
		lowCoverage: [
			{
				file: "src/auth/session.ts",
				summary: { statements: 45, branches: 30, functions: 50, lines: 40 },
				uncoveredLines: "42-50,99,120-135",
			},
		],
		lowCoverageFiles: ["src/auth/session.ts"],
	},
};

// --- Tests ---

describe("relativePath", () => {
	it("strips cwd prefix from absolute path", () => {
		expect(relativePath("/Users/dev/project/src/foo.ts", "/Users/dev/project")).toBe("src/foo.ts");
	});

	it("returns path unchanged if no prefix match", () => {
		expect(relativePath("src/foo.ts", "/Users/dev/project")).toBe("src/foo.ts");
	});
});

describe("getWorstMetric", () => {
	it("returns the metric with the lowest percentage", () => {
		const coverage = failingReport.coverage;
		if (!coverage) throw new Error("fixture missing coverage");
		const f = coverage.lowCoverage[0];
		const worst = getWorstMetric(f);
		expect(worst.label).toBe("Branch");
		expect(worst.pct).toBe(30);
	});

	it("returns first metric when all are equal", () => {
		const f = {
			file: "src/equal.ts",
			summary: { statements: 50, branches: 50, functions: 50, lines: 50 },
			uncoveredLines: "",
		};
		const worst = getWorstMetric(f);
		expect(worst.pct).toBe(50);
	});
});

describe("formatConsoleMarkdown", () => {
	it("returns empty string in silent mode", () => {
		const result = formatConsoleMarkdown(passingReport, { ...baseOptions, consoleOutput: "silent" });
		expect(result).toBe("");
	});

	// --- Compact header ---

	it("passing report has compact header with count and duration", () => {
		const result = formatConsoleMarkdown(passingReport, baseOptions);
		expect(result).toContain("Vitest");
		expect(result).toContain("5 passed");
		expect(result).toContain("120ms");
	});

	it("failing report header shows failed and passed counts", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).toContain("2 failed");
		expect(result).toContain("3 passed");
	});

	it("rounds duration to integer", () => {
		const result = formatConsoleMarkdown(passingReport, baseOptions);
		expect(result).toContain("120ms");
		expect(result).not.toContain("120.456");
	});

	it("includes project name in header when present", () => {
		const withProject = { ...passingReport, project: "core:unit" };
		const result = formatConsoleMarkdown(withProject, baseOptions);
		expect(result).toContain("(core:unit)");
	});

	// --- Failed tests ---

	it("shows file path and test names for failures", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).toContain("src/auth/login.test.ts");
		expect(result).toContain("Auth > validates credentials");
		expect(result).toContain("Auth > rejects invalid token");
	});

	it("shows error messages and diffs", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).toContain("expected true to equal false");
		expect(result).toContain("```diff");
		expect(result).toContain("- true");
		expect(result).toContain("+ false");
	});

	// --- Coverage gaps ---

	it("shows coverage gaps with worst metric, threshold, and uncovered lines", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).toContain("Coverage gaps");
		expect(result).toContain("src/auth/session.ts");
		expect(result).toContain("Branch: 30% (threshold: 80%)");
		expect(result).toContain("uncovered: 42-50,99,120-135");
	});

	it("omits coverage section when no low coverage files", () => {
		const noCovGaps: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 95, branches: 90, functions: 100, lines: 95 },
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
			},
		};
		const result = formatConsoleMarkdown(noCovGaps, baseOptions);
		expect(result).not.toContain("Coverage gaps");
	});

	it("omits coverage section when no coverage data at all", () => {
		const result = formatConsoleMarkdown(passingReport, baseOptions);
		expect(result).not.toContain("Coverage");
	});

	it("does NOT show coverage totals table", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).not.toContain("Statements");
		expect(result).not.toContain("Branches");
		expect(result).not.toContain("Functions");
	});

	it("respects coverageConsoleLimit", () => {
		const manyFiles: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 50, branches: 50, functions: 50, lines: 50 },
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: Array.from({ length: 15 }, (_, i) => ({
					file: `src/file${i}.ts`,
					summary: { statements: 40, branches: 40, functions: 40, lines: 40 },
					uncoveredLines: `${i * 10}-${i * 10 + 5}`,
				})),
				lowCoverageFiles: Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`),
			},
		};
		const result = formatConsoleMarkdown(manyFiles, { ...baseOptions, coverageConsoleLimit: 3 });
		expect(result).toContain("src/file0.ts");
		expect(result).toContain("src/file2.ts");
		expect(result).not.toContain("src/file3.ts");
	});

	// --- Next steps ---

	it("shows next steps with re-run command for failures", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).toContain("Next steps");
		expect(result).toContain("vitest run src/auth/login.test.ts");
	});

	it("suggests MCP tools when mcp option is true", () => {
		const result = formatConsoleMarkdown(failingReport, {
			...baseOptions,
			mcp: true,
		});
		expect(result).toContain("test_history");
		expect(result).toContain('note({ action: "create" })');
	});

	// --- Footer ---

	it("shows passing header without redundant 'All tests passed' line", () => {
		const result = formatConsoleMarkdown(passingReport, baseOptions);
		expect(result).toContain("✓ Vitest");
		expect(result).toContain("passed");
		expect(result).not.toContain("All tests passed");
	});

	it("does NOT show summary table", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).not.toContain("| Passed |");
		expect(result).not.toContain("| Total |");
		expect(result).not.toContain("| Duration |");
	});

	it("shows module-level errors with diffs", () => {
		const reportWithModuleErrors: AgentReport = {
			timestamp: "2024-01-01T00:00:00.000Z",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
			failed: [
				{
					file: "src/broken.test.ts",
					state: "failed",
					duration: 10,
					errors: [
						{
							message: "Module setup error",
							diff: "- expected\n+ actual",
						},
					],
					tests: [
						{
							name: "test",
							fullName: "Broken > test",
							state: "failed",
							duration: 5,
							errors: [{ message: "test failed" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/broken.test.ts"],
		};

		const result = formatConsoleMarkdown(reportWithModuleErrors, baseOptions);
		expect(result).toContain("Module setup error");
		expect(result).toContain("```diff");
		expect(result).toContain("- expected");
		expect(result).toContain("+ actual");
	});

	it("shows module-level errors without diffs", () => {
		const reportWithModuleErrorsNoDiff: AgentReport = {
			timestamp: "2024-01-01T00:00:00.000Z",
			reason: "failed",
			summary: { total: 1, passed: 0, failed: 1, skipped: 0, duration: 50 },
			failed: [
				{
					file: "src/syntax.test.ts",
					state: "failed",
					duration: 10,
					errors: [{ message: "Cannot find module './missing'" }],
					tests: [
						{
							name: "test",
							fullName: "Syntax > test",
							state: "failed",
							duration: 5,
							errors: [{ message: "test err" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/syntax.test.ts"],
		};

		const result = formatConsoleMarkdown(reportWithModuleErrorsNoDiff, baseOptions);
		expect(result).toContain("Cannot find module './missing'");
	});

	// --- Classification labels ---

	it("shows classification label on failed test when present", () => {
		const reportWithClassification: AgentReport = {
			timestamp: "2024-01-01T00:00:00.000Z",
			reason: "failed",
			summary: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 100 },
			failed: [
				{
					file: "src/foo.test.ts",
					state: "failed",
					tests: [
						{
							name: "does something",
							fullName: "Foo > does something",
							state: "failed",
							classification: "new-failure",
							errors: [{ message: "expected 1 to equal 2" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/foo.test.ts"],
		};
		const result = formatConsoleMarkdown(reportWithClassification, baseOptions);
		expect(result).toContain("[new-failure]");
	});

	it("does not show classification label when not present", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).not.toMatch(/\[new-failure\]/);
		expect(result).not.toMatch(/\[persistent\]/);
		expect(result).not.toMatch(/\[flaky\]/);
	});

	// --- Classification-based suggestions ---

	it("shows new-failure and persistent suggestions without advertising a removed command", () => {
		const reportWithMixed: AgentReport = {
			timestamp: "2024-01-01T00:00:00.000Z",
			reason: "failed",
			summary: { total: 4, passed: 2, failed: 2, skipped: 0, duration: 200 },
			failed: [
				{
					file: "src/bar.test.ts",
					state: "failed",
					tests: [
						{
							name: "new test",
							fullName: "Bar > new test",
							state: "failed",
							classification: "new-failure",
							errors: [{ message: "err" }],
						},
					],
				},
				{
					file: "src/baz.test.ts",
					state: "failed",
					tests: [
						{
							name: "old test",
							fullName: "Baz > old test",
							state: "failed",
							classification: "persistent",
							errors: [{ message: "err" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/bar.test.ts", "src/baz.test.ts"],
		};
		const result = formatConsoleMarkdown(reportWithMixed, baseOptions);
		expect(result).toContain("new failure");
		expect(result).toContain("persistent failure");
		// The removed `vitest-agent history` command is no longer advertised.
		expect(result).not.toContain("vitest-agent history");
	});

	it("shows flaky suggestion with retry hint", () => {
		const reportWithFlaky: AgentReport = {
			timestamp: "2024-01-01T00:00:00.000Z",
			reason: "failed",
			summary: { total: 2, passed: 1, failed: 1, skipped: 0, duration: 100 },
			failed: [
				{
					file: "src/flaky.test.ts",
					state: "failed",
					tests: [
						{
							name: "unstable test",
							fullName: "Flaky > unstable test",
							state: "failed",
							classification: "flaky",
							errors: [{ message: "timeout" }],
						},
					],
				},
			],
			unhandledErrors: [],
			failedFiles: ["src/flaky.test.ts"],
		};
		const result = formatConsoleMarkdown(reportWithFlaky, baseOptions);
		expect(result).toContain("flaky test");
		expect(result).toContain("may pass on retry");
		expect(result).not.toContain("vitest-agent history");
	});

	it("does not show history hint when no classifications present", () => {
		const result = formatConsoleMarkdown(failingReport, baseOptions);
		expect(result).not.toContain("vitest-agent history");
	});

	// --- Three-zone coverage ---

	it("shows threshold value per metric in coverage gaps", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 60, branches: 55, functions: 70, lines: 65 },
				thresholds: { global: { lines: 80, functions: 90, branches: 75, statements: 85 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/utils.ts",
						summary: { statements: 60, branches: 55, functions: 70, lines: 65 },
						uncoveredLines: "10-20",
					},
				],
				lowCoverageFiles: ["src/utils.ts"],
			},
		};
		const result = formatConsoleMarkdown(report, baseOptions);
		// Worst metric is branches at 55%, threshold for branches is 75%
		expect(result).toContain("Branch: 55% (threshold: 75%)");
	});

	it("omits threshold suffix when metric threshold is not set", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 60, branches: 55, functions: 70, lines: 65 },
				thresholds: { global: {}, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/utils.ts",
						summary: { statements: 60, branches: 55, functions: 70, lines: 65 },
						uncoveredLines: "10-20",
					},
				],
				lowCoverageFiles: ["src/utils.ts"],
			},
		};
		const result = formatConsoleMarkdown(report, baseOptions);
		expect(result).toContain("Branch: 55%");
		expect(result).not.toContain("threshold:");
	});

	it("shows coverage improvements section when belowTarget has files", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 82, branches: 82, functions: 82, lines: 82 },
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				targets: { global: { lines: 95, functions: 95, branches: 95, statements: 95 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
				belowTarget: [
					{
						file: "src/almost.ts",
						summary: { statements: 85, branches: 82, functions: 88, lines: 84 },
						uncoveredLines: "50-55",
					},
				],
				belowTargetFiles: ["src/almost.ts"],
			},
		};
		const result = formatConsoleMarkdown(report, baseOptions);
		expect(result).toContain("Coverage improvements needed");
		expect(result).toContain("src/almost.ts");
		expect(result).toContain("target: 95%");
	});

	it("omits improvements section when belowTarget is empty", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 40, branches: 40, functions: 40, lines: 40 },
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				targets: { global: { lines: 95, functions: 95, branches: 95, statements: 95 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/bad.ts",
						summary: { statements: 40, branches: 40, functions: 40, lines: 40 },
						uncoveredLines: "1-100",
					},
				],
				lowCoverageFiles: ["src/bad.ts"],
				belowTarget: [],
				belowTargetFiles: [],
			},
		};
		const result = formatConsoleMarkdown(report, baseOptions);
		expect(result).toContain("Coverage gaps");
		expect(result).not.toContain("Coverage improvements needed");
	});
});

// --- Tier determination ---

describe("determineTier", () => {
	it("returns red when tests have failures", () => {
		expect(determineTier(failingReport)).toBe("red");
	});

	it("returns red when there are unhandled errors", () => {
		const report: AgentReport = {
			...passingReport,
			unhandledErrors: [{ message: "boom" }],
		};
		expect(determineTier(report)).toBe("red");
	});

	it("returns red when there are low coverage files", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 50, branches: 50, functions: 50, lines: 50 },
				thresholds: { global: { lines: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/bad.ts",
						summary: { statements: 50, branches: 50, functions: 50, lines: 50 },
						uncoveredLines: "1-10",
					},
				],
				lowCoverageFiles: ["src/bad.ts"],
			},
		};
		expect(determineTier(report)).toBe("red");
	});

	it("returns yellow when targets exist and belowTarget has files", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 85, branches: 85, functions: 85, lines: 85 },
				thresholds: { global: { lines: 80 }, patterns: [] },
				targets: { global: { lines: 95 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
				belowTarget: [
					{
						file: "src/needs-work.ts",
						summary: { statements: 85, branches: 85, functions: 85, lines: 85 },
						uncoveredLines: "10-15",
					},
				],
				belowTargetFiles: ["src/needs-work.ts"],
			},
		};
		expect(determineTier(report)).toBe("yellow");
	});

	it("returns green when targets exist but all targets met", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { statements: 96, branches: 96, functions: 96, lines: 96 },
				thresholds: { global: { lines: 80 }, patterns: [] },
				targets: { global: { lines: 95 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
				belowTarget: [],
				belowTargetFiles: [],
			},
		};
		expect(determineTier(report)).toBe("green");
	});

	it("returns green when all pass and no coverage issues", () => {
		expect(determineTier(passingReport)).toBe("green");
	});
});

// --- Tiered console output ---

describe("tiered console output", () => {
	it("shows green tier with minimal trend summary", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { lines: 95, functions: 90, branches: 85, statements: 92 },
				thresholds: { global: { lines: 90 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
			},
		};
		const output = formatConsoleMarkdown(report, {
			...baseOptions,
			trendSummary: { direction: "improving", runCount: 5 },
		});
		expect(output).toContain("all targets met");
		expect(output).toContain("trending improving over 5 runs");
	});

	it("shows yellow tier with target gap info", () => {
		const report: AgentReport = {
			...passingReport,
			coverage: {
				totals: { lines: 85, functions: 80, branches: 75, statements: 82 },
				thresholds: { global: { lines: 80 }, patterns: [] },
				targets: { global: { lines: 90 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
				belowTarget: [
					{
						file: "src/gap.ts",
						summary: { statements: 82, branches: 75, functions: 80, lines: 85 },
						uncoveredLines: "20-30",
					},
				],
				belowTargetFiles: ["src/gap.ts"],
			},
		};
		const output = formatConsoleMarkdown(report, {
			...baseOptions,
			trendSummary: {
				direction: "improving",
				runCount: 5,
				firstMetric: { name: "lines", from: 82, to: 85, target: 90 },
			},
		});
		expect(output).toContain("below target");
	});

	it("shows red tier with regression info", () => {
		const report: AgentReport = {
			...failingReport,
			coverage: {
				totals: { lines: 70, functions: 60, branches: 50, statements: 65 },
				thresholds: { global: { lines: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/parser.ts",
						summary: { lines: 45, functions: 40, branches: 30, statements: 42 },
						uncoveredLines: "42-50",
					},
				],
				lowCoverageFiles: ["src/parser.ts"],
			},
		};
		const output = formatConsoleMarkdown(report, {
			...baseOptions,
			trendSummary: {
				direction: "regressing",
				runCount: 3,
				firstMetric: { name: "lines", from: 87, to: 84 },
			},
		});
		expect(output).toContain("below threshold");
		expect(output).toContain("trending regressing");
	});
});
