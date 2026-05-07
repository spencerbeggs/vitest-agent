import { describe, expect, it } from "vitest";
import type { AgentReport, CacheManifest } from "vitest-agent-sdk";
import { formatStatus } from "../src/lib/format-status.js";

function makeManifest(projects: CacheManifest["projects"] = []): CacheManifest {
	return {
		updatedAt: "2026-03-20T00:00:00.000Z",
		cacheDir: ".vitest-agent",
		projects,
	};
}

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
	return {
		timestamp: "2026-03-20T00:00:00.000Z",
		reason: "passed",
		summary: { total: 10, passed: 8, failed: 2, skipped: 0, duration: 340 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
		...overrides,
	};
}

describe("formatStatus", () => {
	it("renders a summary table with project entries", () => {
		const manifest = makeManifest([
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "passed",
			},
			{
				project: "utils",
				reportFile: "reports/utils.json",
				lastRun: null,
				lastResult: null,
			},
		]);

		const result = formatStatus(manifest, new Map());
		expect(result).toContain("## Vitest Test Status");
		expect(result).toContain("| Project | Last Run | Result | Report |");
		expect(result).toContain("| core |");
		expect(result).toContain("| passed |");
		expect(result).toContain("| utils |");
		expect(result).toContain("| never |");
		expect(result).toContain("| unknown |");
	});

	it("renders failing project details when reports are provided", () => {
		const manifest = makeManifest([
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "failed",
			},
		]);

		const report = makeReport({
			reason: "failed",
			summary: {
				total: 10,
				passed: 8,
				failed: 2,
				skipped: 0,
				duration: 340,
			},
			failedFiles: ["src/utils.test.ts", "src/coverage.test.ts"],
		});

		const reports = new Map([["core", report]]);
		const result = formatStatus(manifest, reports);

		expect(result).toContain("### Failing: core");
		expect(result).toContain("2 failed, 8 passed (340ms)");
		expect(result).toContain("src/utils.test.ts, src/coverage.test.ts");
	});

	it("skips failing details when report is not available", () => {
		const manifest = makeManifest([
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "failed",
			},
		]);

		const result = formatStatus(manifest, new Map());
		expect(result).not.toContain("### Failing:");
	});

	it("handles empty projects array", () => {
		const manifest = makeManifest([]);
		const result = formatStatus(manifest, new Map());
		expect(result).toContain("## Vitest Test Status");
		expect(result).toContain("| Project | Last Run | Result | Report |");
	});

	it("does not show failing details for passing projects", () => {
		const manifest = makeManifest([
			{
				project: "core",
				reportFile: "reports/core.json",
				lastRun: "2026-03-20T00:00:00.000Z",
				lastResult: "passed",
			},
		]);

		const report = makeReport();
		const reports = new Map([["core", report]]);
		const result = formatStatus(manifest, reports);
		expect(result).not.toContain("### Failing:");
	});
});
