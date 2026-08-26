/**
 * Integration tests for the default reporter.
 *
 * The factory consumes a `ReporterKit` and returns a reporter whose
 * `render(input, kit)` produces one stdout-targeted `RenderedOutput`
 * carrying the dispatched agent-string. These tests build the kit /
 * input directly without threading through the plugin so the reporter's
 * contract is exercised in isolation.
 */

import type {
	AgentReport,
	CoverageReport,
	FileCoverageReport,
	ReporterKit,
	ReporterRenderInput,
	VitestAgentReporter,
} from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter, buildDispatchInputs, resolveCellOptions } from "../src/defaultReporter.js";

const makeKit = (consoleMode: ReporterKit["config"]["consoleMode"] = "agent"): ReporterKit => ({
	config: {
		executor: "agent",
		consoleMode,
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
		runCommand: "pnpm test",
	},
	stdEnv: "agent-shell",
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

describe("DefaultVitestAgentReporter", () => {
	it("renders one stdout RenderedOutput for consoleMode=agent", () => {
		const kit = makeKit("agent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const output = reporter.render(makeInput(), kit);
		expect(output).toHaveLength(1);
		const firstOutput = output[0];
		expect(firstOutput).toBeDefined();
		if (firstOutput === undefined) return;
		expect(firstOutput.target).toBe("stdout");
		expect(firstOutput.contentType).toBe("text/plain");
	});

	it("emits nothing for consoleMode=silent", () => {
		const kit = makeKit("silent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
	});

	it("emits nothing for consoleMode=passthrough", () => {
		const kit = makeKit("passthrough");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
	});

	it("emits nothing for consoleMode=stream", () => {
		const kit = makeKit("stream");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
	});

	it("emits nothing for consoleMode=ci-annotations", () => {
		const kit = makeKit("ci-annotations");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
	});

	it("pushes the github log block alongside the github summary when githubActions is true", () => {
		const kit: ReporterKit = {
			...makeKit("passthrough"),
			config: { ...makeKit("passthrough").config, githubActions: true },
		};
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const input = makeInput({ classifications: new Map([["some test", "flaky"]]) });
		const output = reporter.render(input, kit);
		const summaryOutputs = output.filter((o) => o.target === "github-summary");
		const logOutputs = output.filter((o) => o.target === "stdout" && o.content.startsWith("::group::"));
		expect(summaryOutputs).toHaveLength(1);
		expect(logOutputs).toHaveLength(1);
	});

	it("emits no github-summary output on a clean run with no classifications, coverage gaps, or trend", () => {
		const kit: ReporterKit = {
			...makeKit("passthrough"),
			config: { ...makeKit("passthrough").config, githubActions: true },
		};
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const output = reporter.render(makeInput(), kit);
		const summaryOutputs = output.filter((o) => o.target === "github-summary");
		expect(summaryOutputs).toHaveLength(0);
	});

	describe("github-summary sections", () => {
		const githubKit: ReporterKit = {
			...makeKit("passthrough"),
			config: { ...makeKit("passthrough").config, githubActions: true },
		};

		const renderSummary = (input: ReporterRenderInput): string | undefined => {
			const reporter = asSingle(DefaultVitestAgentReporter(githubKit));
			const output = reporter.render(input, githubKit);
			return output.find((o) => o.target === "github-summary")?.content;
		};

		it("emits a single '## vitest-agent' heading", () => {
			const content = renderSummary(makeInput({ classifications: new Map([["a test", "flaky"]]) }));
			expect(content).toBeDefined();
			expect(content?.trimStart().startsWith("## vitest-agent")).toBe(true);
		});

		it("brackets the payload in newlines so appending to GITHUB_STEP_SUMMARY cannot fuse blocks", () => {
			const content = renderSummary(makeInput({ classifications: new Map([["a test", "flaky"]]) }));
			expect(content?.startsWith("\n")).toBe(true);
			expect(content?.endsWith("\n")).toBe(true);
		});

		it("includes a Classifications section counting each non-stable classification", () => {
			const content = renderSummary(
				makeInput({
					classifications: new Map([
						["t1", "flaky"],
						["t2", "flaky"],
						["t3", "new-failure"],
						["t4", "stable"],
					]),
				}),
			);
			expect(content).toContain("### Classifications");
			expect(content).toContain("flaky");
			expect(content).toContain("2");
			expect(content).toContain("new-failure");
		});

		it("omits the Classifications section when every classification is stable", () => {
			const content = renderSummary(makeInput({ classifications: new Map([["t1", "stable"]]) }));
			expect(content).toBeUndefined();
		});

		const makeCoverageReport = (belowTarget: ReadonlyArray<FileCoverageReport>): CoverageReport => ({
			totals: { statements: 90, branches: 80, functions: 85, lines: 88 },
			thresholds: { global: {}, patterns: [] },
			scoped: false,
			lowCoverage: belowTarget,
			lowCoverageFiles: belowTarget.map((f) => f.file),
			belowTarget,
			belowTargetFiles: belowTarget.map((f) => f.file),
		});

		const makeFileCoverage = (file: string): FileCoverageReport => ({
			file,
			summary: { statements: 50, branches: 40, functions: 45, lines: 48 },
			uncoveredLines: "1-10",
		});

		it("includes a Coverage section with a relativized file table when belowTarget entries exist", () => {
			const absoluteFile = `${process.cwd()}/packages/reporter/src/defaultReporter.ts`;
			const content = renderSummary(
				makeInput({
					reports: [makeReport({ coverage: makeCoverageReport([makeFileCoverage(absoluteFile)]) })],
				}),
			);
			expect(content).toContain("### Coverage");
			expect(content).toContain("1 file(s) below target");
			expect(content).toContain("packages/reporter/src/defaultReporter.ts");
			expect(content).not.toContain(absoluteFile);
		});

		it("notes truncation when more than 10 files are below target", () => {
			const files = Array.from({ length: 12 }, (_, i) => makeFileCoverage(`src/file-${i}.ts`));
			const content = renderSummary(makeInput({ reports: [makeReport({ coverage: makeCoverageReport(files) })] }));
			expect(content).toContain("12 file(s) below target");
			expect(content).toContain("+2 more not shown");
		});

		it("omits the Coverage section when no report has belowTarget entries", () => {
			const content = renderSummary(
				makeInput({
					reports: [makeReport({ coverage: makeCoverageReport([]) })],
					classifications: new Map([["t1", "flaky"]]),
				}),
			);
			expect(content).not.toContain("### Coverage");
		});

		it("includes a Trend section with direction, runCount, and firstMetric when present", () => {
			const content = renderSummary(
				makeInput({
					classifications: new Map([["t1", "flaky"]]),
					trendSummary: {
						direction: "improving",
						runCount: 5,
						firstMetric: { name: "lines", from: 80, to: 90, target: 95 },
					},
				}),
			);
			expect(content).toContain("### Trend");
			expect(content).toContain("improving");
			expect(content).toContain("5");
			expect(content).toContain("lines");
			expect(content).toContain("95");
		});

		it("omits the Trend section when trendSummary is absent", () => {
			const content = renderSummary(makeInput({ classifications: new Map([["t1", "flaky"]]) }));
			expect(content).not.toContain("### Trend");
		});

		it("separates multiple sections with a blank line", () => {
			const content = renderSummary(
				makeInput({
					classifications: new Map([["t1", "flaky"]]),
					trendSummary: { direction: "stable", runCount: 3 },
				}),
			);
			expect(content).toContain("\n\n### Trend");
		});
	});

	it("workspace shape kicks in with more than one project report", () => {
		const kit = makeKit("agent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const reports: ReadonlyArray<AgentReport> = [
			makeReport({ project: "alpha", summary: { total: 5, passed: 5, failed: 0, skipped: 0, duration: 10 } }),
			makeReport({ project: "beta", summary: { total: 3, passed: 3, failed: 0, skipped: 0, duration: 8 } }),
			makeReport({ project: "gamma", summary: { total: 2, passed: 2, failed: 0, skipped: 0, duration: 5 } }),
		];
		const output = reporter.render(makeInput({ reports }), kit);
		expect(output).toHaveLength(1);
		const firstOutput = output[0];
		expect(firstOutput).toBeDefined();
		if (firstOutput === undefined) return;
		expect(firstOutput.content).toContain("Projects (3):");
		expect(firstOutput.content).toContain("alpha");
		expect(firstOutput.content).toContain("beta");
		expect(firstOutput.content).toContain("gamma");
	});
});

describe("buildDispatchInputs and resolveCellOptions", () => {
	it("buildDispatchInputs computes shape and outcome from the reduced state", () => {
		const kit = makeKit("agent");
		const input = makeInput();
		const inputs = buildDispatchInputs(initialRenderState, input);
		expect(inputs.projects).toHaveLength(1);
		const firstProject = inputs.projects[0];
		expect(firstProject).toBeDefined();
		if (firstProject === undefined) return;
		expect(firstProject.name).toBe("demo");
		expect(firstProject.passCount).toBe(1);
		expect(inputs.trend).toBe(null);
		// projects.length === 1 falls back to single-project (modules empty).
		expect(inputs.shape).toBe("single-project");
		expect(inputs.outcome).toBe("all-pass");
		expect(resolveCellOptions(kit).noColor).toBe(true);
	});

	it("buildDispatchInputs classifies workspace when more than one project report present", () => {
		const input = makeInput({
			reports: [makeReport({ project: "a" }), makeReport({ project: "b" })],
		});
		const inputs = buildDispatchInputs(initialRenderState, input);
		expect(inputs.shape).toBe("workspace");
		expect(inputs.projects).toHaveLength(2);
	});
});
