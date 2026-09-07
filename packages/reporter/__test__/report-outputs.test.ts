/**
 * Unit tests for the `report`-targeted outputs the default reporter
 * emits — `run.json` (the versioned `RunReportFile` envelope) and
 * `summary.md` (the same markdown the GitHub step summary carries).
 */

import type { AgentReport, ReporterKit, ReporterRenderInput, VitestAgentReporter } from "@vitest-agent/sdk";
import { RUN_REPORT_FILE_SCHEMA_URL, RunReportFile } from "@vitest-agent/sdk";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter } from "../src/defaultReporter.js";

const makeKit = (overrides: Partial<ReporterKit["config"]> = {}): ReporterKit => ({
	config: {
		executor: "agent",
		consoleMode: "agent",
		mcp: false,
		consoleOutput: "full",
		omitPassingTests: false,
		coverageConsoleLimit: 3,
		includeBareZero: false,
		githubActions: false,
		githubSummary: false,
		coverageMode: "full",
		format: "markdown",
		detail: "standard",
		noColor: true,
		...overrides,
	},
	stdEnv: "agent-shell",
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

const asSingle = (r: VitestAgentReporter | ReadonlyArray<VitestAgentReporter>): VitestAgentReporter => {
	if (Array.isArray(r)) {
		const first = r[0];
		if (first === undefined) throw new Error("Expected at least one reporter");
		return first;
	}
	return r as VitestAgentReporter;
};

const makeInput = (overrides: Partial<ReporterRenderInput> = {}): ReporterRenderInput => ({
	reports: [makeReport()],
	classifications: new Map(),
	...overrides,
});

describe("default reporter report files", () => {
	it("emits run.json parsing against RunReportFile", () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput(), kit);
		const runJson = outputs.find((o) => o.target === "report" && o.filename === "run.json");
		expect(runJson).toBeDefined();
		expect(runJson?.contentType).toBe("application/json");
		const parsed = Schema.decodeUnknownSync(RunReportFile)(JSON.parse(runJson?.content ?? "{}"));
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.$schema).toBe(RUN_REPORT_FILE_SCHEMA_URL);
		expect(parsed.reports.length).toBeGreaterThan(0);
	});

	it("writes $schema as the first key of run.json", () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput(), kit);
		const runJson = outputs.find((o) => o.target === "report" && o.filename === "run.json");
		const keys = Object.keys(JSON.parse(runJson?.content ?? "{}") as Record<string, unknown>);
		expect(keys[0]).toBe("$schema");
	});

	it("emits summary.md with the vitest-agent heading", () => {
		const kit = makeKit();
		const classifications = new Map<string, "stable" | "new-failure" | "persistent" | "flaky" | "recovered">([
			["demo > test a", "flaky"],
		]);
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput({ classifications }), kit);
		const summary = outputs.find((o) => o.target === "report" && o.filename === "summary.md");
		expect(summary?.contentType).toBe("text/markdown");
		expect(summary?.content).toContain("## vitest-agent");
		expect(summary?.content).toContain("### Totals");
		expect(summary?.content).toContain("| flaky | 1 |");
	});

	it("writes the totals table and no conditional sections on an all-green run", () => {
		const kit = makeKit();
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput(), kit);
		const summary = outputs.find((o) => o.target === "report" && o.filename === "summary.md");
		// Never null: Vitest's own job summary is disabled, so a blank body
		// would leave a passing CI run with no summary at all.
		expect(summary).toBeDefined();
		expect(summary?.content).toContain("### Totals");
		expect(summary?.content).toContain("| Project | Passed | Failed | Skipped | Duration |");
		expect(summary?.content).toContain("| demo | 1 | 0 | 0 | 10ms |");
		expect(summary?.content).not.toContain("### Classifications");
		expect(summary?.content).not.toContain("### Coverage");
		expect(summary?.content).not.toContain("### Trend");
		// A single-project run gets no Total row — it would repeat the row above.
		expect(summary?.content).not.toContain("**Total**");
		expect(outputs.find((o) => o.target === "report" && o.filename === "run.json")).toBeDefined();
	});

	it("appends a Total row and folds suite failures for a multi-project run", () => {
		const kit = makeKit();
		const reports: ReadonlyArray<AgentReport> = [
			makeReport({ project: "alpha", summary: { total: 5, passed: 4, failed: 1, skipped: 0, duration: 900 } }),
			makeReport({
				project: "beta",
				summary: { total: 2, passed: 1, failed: 0, skipped: 1, duration: 400 },
				// A module that failed to load: no failed test cases, but the
				// project is not green. `countSuiteFailures` must surface it.
				failed: [{ file: "src/broken.ts", state: "failed", tests: [] }],
			}),
		];
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput({ reports }), kit);
		const summary = outputs.find((o) => o.target === "report" && o.filename === "summary.md");
		expect(summary?.content).toContain("| alpha | 4 | 1 | 0 | 900ms |");
		expect(summary?.content).toContain("| beta | 1 | 1 | 1 | 400ms |");
		expect(summary?.content).toContain("| **Total** | 5 | 2 | 1 | 1.3s |");
	});

	it("still emits report files in a non-agent console mode", () => {
		const kit = makeKit({ executor: "ci", consoleMode: "silent" });
		const outputs = asSingle(DefaultVitestAgentReporter(kit)).render(makeInput(), kit);
		expect(outputs.find((o) => o.target === "report" && o.filename === "run.json")).toBeDefined();
	});
});
