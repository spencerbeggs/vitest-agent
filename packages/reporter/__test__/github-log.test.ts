/**
 * Unit tests for `renderGithubLog` — the collapsed-group stdout log block
 * emitted alongside the GitHub step summary when `kit.config.githubActions`
 * is true.
 */

import type { AgentReport, ReporterKit, ReporterRenderInput } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { renderGithubLog } from "../src/githubLog.js";

const makeKit = (overrides: Partial<ReporterKit["config"]> = {}): ReporterKit => ({
	config: {
		executor: "ci",
		consoleMode: "passthrough",
		mcp: false,
		consoleOutput: "full",
		omitPassingTests: false,
		coverageConsoleLimit: 3,
		includeBareZero: false,
		githubActions: true,
		githubSummary: true,
		coverageMode: "full",
		format: "markdown",
		detail: "standard",
		noColor: true,
		...overrides,
	},
	stdEnv: "ci-github",
	stdOsc8: (_url, label) => label,
});

const makeReport = (overrides: Partial<AgentReport> = {}): AgentReport => ({
	timestamp: "2026-05-14T00:00:00.000Z",
	project: "demo",
	reason: "passed",
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...overrides,
});

const makeInput = (overrides: Partial<ReporterRenderInput> = {}): ReporterRenderInput => ({
	reports: [makeReport()],
	classifications: new Map(),
	...overrides,
});

describe("renderGithubLog", () => {
	it("wraps the content in ::group::/::endgroup:: markers targeting stdout as text/plain", () => {
		const output = renderGithubLog(makeInput(), makeKit());
		expect(output.target).toBe("stdout");
		expect(output.contentType).toBe("text/plain");
		const lines = output.content.split("\n");
		expect(lines[0]).toBe("::group::vitest-agent");
		expect(lines.at(-1)).toBe("::endgroup::");
	});

	it("emits per-project, coverage, classification, and dbPath lines for a mixed pass/fail/flaky run", () => {
		const reports = [
			makeReport({
				project: "api",
				summary: { total: 5, passed: 3, failed: 1, skipped: 1, duration: 20 },
				coverage: {
					totals: { statements: 80, branches: 70, functions: 90, lines: 80 },
					thresholds: { global: {}, patterns: [] },
					scoped: false,
					lowCoverage: [],
					lowCoverageFiles: [],
					belowTarget: [
						{
							file: "src/foo.ts",
							summary: { statements: 50, branches: 40, functions: 60, lines: 50 },
							uncoveredLines: "10-20",
						},
					],
				},
			}),
		];
		const classifications = new Map<string, "stable" | "new-failure" | "persistent" | "flaky" | "recovered">([
			["api > test a", "stable"],
			["api > test b", "flaky"],
			["api > test c", "flaky"],
			["api > test d", "new-failure"],
		]);
		const output = renderGithubLog(makeInput({ reports, classifications }), makeKit({ dbPath: "/tmp/data.db" }));
		expect(output.content).toContain("api: 3/5 passed, 1 failed, 1 skipped");
		expect(output.content).toContain("coverage: 1 file(s) below target (src/foo.ts)");
		expect(output.content).toContain("flaky: 2");
		expect(output.content).toContain("new-failure: 1");
		expect(output.content).not.toContain("stable:");
		expect(output.content).toContain("persisted to: /tmp/data.db");
	});

	it("omits classification and coverage lines for a clean run instead of printing zeros", () => {
		const classifications = new Map<string, "stable" | "new-failure" | "persistent" | "flaky" | "recovered">([
			["demo > test a", "stable"],
		]);
		const output = renderGithubLog(makeInput({ classifications }), makeKit());
		expect(output.content).not.toContain("coverage:");
		expect(output.content).not.toContain("classifications:");
		expect(output.content).not.toContain("persisted to:");
	});
});
