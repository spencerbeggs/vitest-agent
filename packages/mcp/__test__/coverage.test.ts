import { describe, expect, it } from "vitest";
import type { TestCoverageResultType } from "../src/tools/coverage.js";
import { formatTestCoverageMarkdown } from "../src/tools/coverage.js";

describe("formatTestCoverageMarkdown", () => {
	it("renders enforced threshold and aspirational target as distinct labelled lines (issue #237)", () => {
		const data: TestCoverageResultType = {
			dataAvailable: true,
			project: "cov-proj",
			coverage: {
				totals: { statements: 75, branches: 75, functions: 75, lines: 75 },
				thresholds: { global: { statements: 70, branches: 70, functions: 70, lines: 70 }, patterns: [] },
				targets: { global: { statements: 90, branches: 90, functions: 90, lines: 90 }, patterns: [] },
				baselines: { global: { statements: 95, branches: 95, functions: 95, lines: 95 }, patterns: [] },
				scoped: false,
				lowCoverage: [],
				lowCoverageFiles: [],
			},
		};

		const md = formatTestCoverageMarkdown(data);

		expect(md).toContain("Enforced threshold");
		expect(md).toContain("Target");
		// Threshold value (70%) and target value (90%) must both be visible
		// and distinct from each other AND from the baseline (95%, which
		// must never appear as if it were the enforced bar).
		expect(md).toContain("70%");
		expect(md).toContain("90%");
		// All four metrics (75%) pass the 70% threshold.
		expect(md).toContain("✅ All files meet coverage thresholds.");
	});

	it("labels lowCoverage against the enforced threshold, distinct from belowTarget", () => {
		const data: TestCoverageResultType = {
			dataAvailable: true,
			project: "cov-proj",
			coverage: {
				totals: { statements: 60, branches: 60, functions: 60, lines: 60 },
				thresholds: { global: { statements: 70 }, patterns: [] },
				targets: { global: { statements: 90 }, patterns: [] },
				baselines: { global: {}, patterns: [] },
				scoped: false,
				lowCoverage: [
					{
						file: "src/bad.ts",
						summary: { statements: 40, branches: 40, functions: 40, lines: 40 },
						uncoveredLines: "1-5",
					},
				],
				lowCoverageFiles: ["src/bad.ts"],
				belowTarget: [
					{
						file: "src/almost.ts",
						summary: { statements: 80, branches: 80, functions: 80, lines: 80 },
						uncoveredLines: "10-12",
					},
				],
				belowTargetFiles: ["src/almost.ts"],
			},
		};

		const md = formatTestCoverageMarkdown(data);

		expect(md).toContain("below the enforced threshold");
		expect(md).toContain("src/bad.ts");
		expect(md).toContain("below the aspirational target");
		expect(md).toContain("src/almost.ts");
	});
});
