import { describe, expect, it } from "vitest";
import type { AgentReport } from "vitest-agent-sdk";
import { formatCoverage } from "../src/lib/format-coverage.js";

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
	return {
		timestamp: "2026-03-20T00:00:00.000Z",
		reason: "passed",
		summary: { total: 10, passed: 10, failed: 0, skipped: 0, duration: 100 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
		...overrides,
	};
}

describe("formatCoverage", () => {
	it("renders cached threshold and project heading", () => {
		const report = makeReport({
			coverage: {
				totals: {
					statements: 80,
					branches: 70,
					functions: 90,
					lines: 75,
				},
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/utils.ts",
						summary: {
							statements: 60,
							branches: 50,
							functions: 70,
							lines: 55,
						},
						uncoveredLines: "42-50,99",
					},
				],
				lowCoverageFiles: ["src/utils.ts"],
			},
		});

		const result = formatCoverage([{ project: "core", report }]);

		expect(result).toContain("## Coverage Gaps");
		expect(result).toContain("**Minimum thresholds:** lines: 80%, functions: 80%, branches: 80%, statements: 80%");
		expect(result).toContain("### Files below minimum thresholds");
		expect(result).toContain("| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s |");
		expect(result).toContain("| src/utils.ts | 60 | 50 | 70 | 55 | 42-50,99 |");
	});

	it("renders multiple files in coverage table", () => {
		const report = makeReport({
			coverage: {
				totals: {
					statements: 70,
					branches: 60,
					functions: 80,
					lines: 65,
				},
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/utils.ts",
						summary: {
							statements: 60,
							branches: 50,
							functions: 70,
							lines: 55,
						},
						uncoveredLines: "42-50",
					},
					{
						file: "src/coverage.ts",
						summary: {
							statements: 40,
							branches: 30,
							functions: 50,
							lines: 35,
						},
						uncoveredLines: "1-20,100-120",
					},
				],
				lowCoverageFiles: ["src/utils.ts", "src/coverage.ts"],
			},
		});

		const result = formatCoverage([{ project: "core", report }]);

		expect(result).toContain("| src/utils.ts |");
		expect(result).toContain("| src/coverage.ts |");
	});

	it("dedupes coverage data across projects (coverage is global, not per-project)", () => {
		// In real monorepo runs the reporter attaches the same global
		// coverage data to every project's report. Without dedupe the
		// CLI would print every file once per project section.
		const sharedCoverage = {
			totals: { statements: 80, branches: 70, functions: 90, lines: 75 },
			thresholds: { global: { lines: 80 } as const, patterns: [] as Array<[string, never]> },
			scoped: false,
			lowCoverage: [
				{
					file: "src/a.ts",
					summary: { statements: 50, branches: 40, functions: 60, lines: 45 },
					uncoveredLines: "10-20",
				},
			],
			lowCoverageFiles: ["src/a.ts"],
		};
		const report1 = makeReport({ coverage: sharedCoverage });
		const report2 = makeReport({ coverage: sharedCoverage });

		const result = formatCoverage([
			{ project: "core", report: report1 },
			{ project: "utils", report: report2 },
		]);

		// Single threshold line + single table row (deduped on file path).
		const thresholdMatches = result.match(/\*\*Minimum thresholds:\*\*/g) ?? [];
		expect(thresholdMatches.length).toBe(1);
		const fileMatches = result.match(/\| src\/a\.ts \|/g) ?? [];
		expect(fileMatches.length).toBe(1);
		// No per-project headings: coverage is workspace-global.
		expect(result).not.toContain("### core");
		expect(result).not.toContain("### utils");
	});

	it("skips projects with no coverage", () => {
		const report = makeReport();
		const result = formatCoverage([{ project: "core", report }]);

		expect(result).toContain("## Coverage Gaps");
		expect(result).not.toContain("### Files below");
	});

	it("emits all-targets-met line when coverage data exists with no gaps", () => {
		// When every project's coverage data shows no files below
		// thresholds AND no files below targets, the formatter must
		// not leave an empty `## Coverage Gaps` heading dangling. The
		// CLI's job is to give agents an unambiguous signal that there
		// is nothing to do. A bare heading with no body is ambiguous;
		// an explicit "all targets met" line is not.
		const report = makeReport({
			coverage: {
				totals: {
					statements: 100,
					branches: 100,
					functions: 100,
					lines: 100,
				},
				thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
			},
		});

		const result = formatCoverage([{ project: "core", report }]);

		expect(result).toContain("## Coverage Gaps");
		expect(result).toContain("All targets met — no coverage gaps.");
		expect(result).not.toContain("### Files below");
	});

	it("handles empty reports array", () => {
		const result = formatCoverage([]);
		expect(result).toContain("## Coverage Gaps");
	});

	it("renders aspirational targets line and below-targets table when targets are set and only below-target files exist", () => {
		// Hits three coverage gaps in one shot:
		//  - the `for (const f of cov.belowTarget ?? [])` branch where
		//    `belowTarget` is provided non-empty (the truthy nullish-
		//    coalescing arm).
		//  - the `if (targets) { aspirational targets line }` true
		//    branch -- emits the **Aspirational targets:** line.
		//  - the `if (belowTargetsByFile.size > 0)` block when
		//    `belowThresholdsByFile.size === 0` (no minimum-threshold
		//    files, only below-target files), so the only table the
		//    formatter renders is the aspirational-targets one.
		const report = makeReport({
			coverage: {
				totals: {
					statements: 85,
					branches: 80,
					functions: 90,
					lines: 85,
				},
				thresholds: {
					global: { lines: 80, functions: 80, branches: 80, statements: 80 },
					patterns: [],
				},
				targets: {
					global: { lines: 95, functions: 95, branches: 95, statements: 95 },
					patterns: [],
				},
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
				belowTarget: [
					{
						file: "src/payments.ts",
						summary: {
							statements: 88,
							branches: 82,
							functions: 92,
							lines: 87,
						},
						uncoveredLines: "12-15,40",
					},
				],
				belowTargetFiles: ["src/payments.ts"],
			},
		});

		const result = formatCoverage([{ project: "core", report }]);

		expect(result).toContain("## Coverage Gaps");
		expect(result).toContain("**Aspirational targets:** lines: 95%, functions: 95%, branches: 95%, statements: 95%");
		expect(result).toContain("### Files below aspirational targets");
		expect(result).toContain("| src/payments.ts | 88 | 82 | 92 | 87 | 12-15,40 |");
		// No minimum-threshold table emitted (lowCoverage is empty).
		expect(result).not.toContain("### Files below minimum thresholds");
	});

	it("dedupes belowTarget across projects (coverage is global, not per-project)", () => {
		// Mirrors the existing dedupe test but for the belowTarget
		// path so the `if (!belowTargetsByFile.has(f.file))` branch is
		// exercised with both the cache-miss (first project) and the
		// cache-hit (second project) cases.
		const sharedCoverage = {
			totals: { statements: 85, branches: 80, functions: 90, lines: 85 },
			thresholds: {
				global: { lines: 80 } as const,
				patterns: [] as Array<[string, never]>,
			},
			targets: {
				global: { lines: 95 } as const,
				patterns: [] as Array<[string, never]>,
			},
			scoped: false,
			lowCoverage: [],
			lowCoverageFiles: [],
			belowTarget: [
				{
					file: "src/b.ts",
					summary: { statements: 88, branches: 82, functions: 92, lines: 87 },
					uncoveredLines: "5-9",
				},
			],
			belowTargetFiles: ["src/b.ts"],
		};
		const report1 = makeReport({ coverage: sharedCoverage });
		const report2 = makeReport({ coverage: sharedCoverage });

		const result = formatCoverage([
			{ project: "core", report: report1 },
			{ project: "utils", report: report2 },
		]);

		// Single below-target row (deduped on file path across projects).
		const fileMatches = result.match(/\| src\/b\.ts \|/g) ?? [];
		expect(fileMatches.length).toBe(1);
		expect(result).toContain("### Files below aspirational targets");
	});
});
