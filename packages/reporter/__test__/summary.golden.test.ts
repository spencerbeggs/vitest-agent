/**
 * Golden pins for the default reporter's machine-and-CI text surfaces: the
 * GFM step summary, the `summary.md` report file, the `::group::` log
 * block, and the agent-mode stdout string. Each one is pinned byte-for-byte
 * so a change to a shared primitive (duration, percent, glyph) shows up as
 * a reviewed diff in a snapshot file, not a silent drift.
 */

import type {
	AgentReport,
	CoverageReport,
	FileCoverageReport,
	ReporterKit,
	ReporterRenderInput,
	VitestAgentReporter,
} from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter } from "../src/defaultReporter.js";
import { renderGithubLog } from "../src/githubLog.js";

const makeKit = (overrides: Partial<ReporterKit["config"]> = {}): ReporterKit => ({
	config: {
		executor: "ci",
		consoleMode: "agent",
		mcp: false,
		consoleOutput: "full",
		omitPassingTests: false,
		coverageConsoleLimit: 3,
		includeBareZero: false,
		githubActions: true,
		githubSummary: true,
		coverageMode: "full",
		detail: "standard",
		noColor: true,
		runCommand: "pnpm test",
		dbPath: "/tmp/vitest-agent/data.db",
		...overrides,
	},
	stdEnv: "ci-github",
	stdOsc8: (_url, label) => label,
});

const asSingle = (r: VitestAgentReporter | ReadonlyArray<VitestAgentReporter>): VitestAgentReporter => {
	if (Array.isArray(r)) {
		const first = r[0];
		if (first === undefined) throw new Error("Expected at least one reporter");
		return first;
	}
	return r as VitestAgentReporter;
};

const fileCoverage = (file: string, lines: number): FileCoverageReport => ({
	file,
	summary: { statements: lines + 1.25, branches: lines - 10, functions: lines + 5, lines },
	uncoveredLines: "12-18, 40",
});

const coverage = (belowTarget: ReadonlyArray<FileCoverageReport>): CoverageReport => ({
	totals: { statements: 83.33, branches: 71.4, functions: 90, lines: 82.75 },
	thresholds: { global: {}, patterns: [] },
	scoped: false,
	lowCoverage: belowTarget,
	lowCoverageFiles: belowTarget.map((f) => f.file),
	belowTarget,
	belowTargetFiles: belowTarget.map((f) => f.file),
});

// Durations chosen to straddle the formatter's unit boundaries: a
// fractional sub-second value, an exact second, and a multi-minute value.
const reports: ReadonlyArray<AgentReport> = [
	{
		timestamp: "2026-05-14T00:00:00.000Z",
		project: "alpha",
		reason: "failed",
		summary: { total: 6, passed: 4, failed: 2, skipped: 0, duration: 250.4 },
		failed: [
			{
				file: "src/math.test.ts",
				state: "failed",
				tests: [
					{
						name: "adds",
						fullName: "math > adds",
						state: "failed",
						errors: [{ message: "AssertionError: expected 3 to be 4", diff: "- 4\n+ 3" }],
					},
					{
						name: "waits",
						fullName: "math > waits",
						state: "failed",
						errors: [{ message: "Test timed out in 5000ms." }],
					},
				],
			},
		],
		unhandledErrors: [],
		failedFiles: ["src/math.test.ts"],
		coverage: coverage([fileCoverage("src/math.ts", 48.5), fileCoverage("src/strings.ts", 61)]),
	},
	{
		timestamp: "2026-05-14T00:00:00.000Z",
		project: "beta",
		reason: "passed",
		summary: { total: 3, passed: 2, failed: 0, skipped: 1, duration: 1000 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
	},
	{
		timestamp: "2026-05-14T00:00:00.000Z",
		project: "gamma",
		reason: "passed",
		summary: { total: 9, passed: 9, failed: 0, skipped: 0, duration: 65_300 },
		failed: [],
		unhandledErrors: [],
		failedFiles: [],
		coverage: coverage([fileCoverage("src/a.ts", 10), fileCoverage("src/b.ts", 20), fileCoverage("src/c.ts", 30)]),
	},
];

const input: ReporterRenderInput = {
	reports,
	classifications: new Map([
		["alpha > math > adds", "new-failure"],
		["alpha > math > waits", "persistent"],
		["beta > x", "flaky"],
		["gamma > y", "recovered"],
		["gamma > z", "stable"],
	]),
	trendSummary: {
		direction: "regressing",
		runCount: 7,
		firstMetric: { name: "lines", from: 88.5, to: 82.75, target: 90 },
	},
};

const singleInput: ReporterRenderInput = {
	reports: [
		{
			timestamp: "2026-05-14T00:00:00.000Z",
			project: "solo",
			reason: "passed",
			summary: { total: 2, passed: 2, failed: 0, skipped: 0, duration: 999.6 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
		},
	],
	classifications: new Map(),
};

describe("default reporter — golden text surfaces", () => {
	it("pins the GFM step summary for a multi-project run with every section", async () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(input, kit);
		const summary = outputs.find((o) => o.target === "github-summary");
		await expect(summary?.content).toMatchFileSnapshot("./snapshots/github-summary.multi.md");
	});

	it("pins summary.md for a multi-project run with every section", async () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(input, kit);
		const summary = outputs.find((o) => o.target === "report" && o.filename === "summary.md");
		await expect(summary?.content).toMatchFileSnapshot("./snapshots/summary.multi.md");
	});

	it("pins summary.md for a green single-project run", async () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(singleInput, kit);
		const summary = outputs.find((o) => o.target === "report" && o.filename === "summary.md");
		await expect(summary?.content).toMatchFileSnapshot("./snapshots/summary.single.md");
	});

	it("pins the ::group:: log block", async () => {
		const kit = makeKit();
		await expect(renderGithubLog(input, kit).content).toMatchFileSnapshot("./snapshots/github-log.multi.txt");
	});

	it("pins the agent-mode stdout string for the same multi-project run", async () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(input, kit);
		const stdout = outputs.find((o) => o.target === "stdout" && !o.content.startsWith("::group::"));
		await expect(stdout?.content).toMatchFileSnapshot("./snapshots/agent-stdout.multi.txt");
	});
});
