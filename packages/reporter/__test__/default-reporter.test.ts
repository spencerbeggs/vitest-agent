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
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	VitestAgentReporter,
} from "@vitest-agent/sdk";
import { initialRenderState } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter, buildDispatchInputs } from "../src/defaultReporter.js";

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
		detail: "standard",
		noColor: true,
		runCommand: "pnpm test",
	},
	stdEnv: "agent-shell",
});

const asSingle = (r: VitestAgentReporter | ReadonlyArray<VitestAgentReporter>): VitestAgentReporter => {
	if (Array.isArray(r)) {
		const first = r[0];
		if (first === undefined) throw new Error("Expected at least one reporter");
		return first;
	}
	return r as VitestAgentReporter;
};

// `report`-targeted outputs (run.json / summary.md) are emitted in every
// console mode — they are the machine-facing artifact and the plugin,
// not the console mode, decides whether they reach disk. These tests are
// about console output, so filter them out.
const consoleOutputs = (outputs: ReadonlyArray<RenderedOutput>): ReadonlyArray<RenderedOutput> =>
	outputs.filter((o) => o.target !== "report");

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
		const output = consoleOutputs(reporter.render(makeInput(), kit));
		expect(output).toHaveLength(1);
		const firstOutput = output[0];
		expect(firstOutput).toBeDefined();
		if (firstOutput === undefined) return;
		expect(firstOutput.target).toBe("stdout");
		expect(firstOutput.contentType).toBe("text/plain");
	});

	it("renders the input's suggested actions as a compact Actions list in agent mode (issue #544)", () => {
		const kit = makeKit("agent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const suggestedActions = [
			{
				severity: "warn" as const,
				title: "Re-run the flaky test",
				detail: "pnpm vitest run a.test.ts",
				targetTool: "run_tests",
			},
		];
		// Two reports: the fold resets on each RunStarted, so the actions must ride every stream.
		const input = makeInput({
			reports: [makeReport({ project: "a" }), makeReport({ project: "b" })],
			suggestedActions,
		});
		const content = consoleOutputs(reporter.render(input, kit))[0]?.content ?? "";
		expect(content).toContain("Actions:\n- warn: Re-run the flaky test (tool: run_tests)\n  pnpm vitest run a.test.ts");
		expect(content.split("Actions:")).toHaveLength(2);
		expect(consoleOutputs(reporter.render(makeInput(), kit))[0]?.content).not.toContain("Actions:");
	});

	it("renders the report's console leaks in agent mode (issue #544)", () => {
		const kit = makeKit("agent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const consoleLeaks = {
			total: 2,
			byFile: [{ file: "src/a.test.ts", stdout: 2, stderr: 0, sample: "debug: starting" }],
		};
		const content = consoleOutputs(reporter.render(makeInput({ reports: [makeReport({ consoleLeaks })] }), kit))[0]
			?.content;
		expect(content).toContain("Console leaks: passing tests wrote 2 console lines in 1 file;");
		expect(content).toContain("  src/a.test.ts (2 stdout): debug: starting");
	});

	it("emits nothing for consoleMode=silent", () => {
		const kit = makeKit("silent");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(consoleOutputs(reporter.render(makeInput(), kit))).toEqual([]);
	});

	it("emits nothing for consoleMode=passthrough", () => {
		const kit = makeKit("passthrough");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(consoleOutputs(reporter.render(makeInput(), kit))).toEqual([]);
	});

	it("emits nothing for consoleMode=stream", () => {
		const kit = makeKit("stream");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(consoleOutputs(reporter.render(makeInput(), kit))).toEqual([]);
	});

	it("emits nothing for consoleMode=ci-annotations", () => {
		const kit = makeKit("ci-annotations");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(consoleOutputs(reporter.render(makeInput(), kit))).toEqual([]);
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

	it("still emits a github-summary carrying only totals on a clean run", () => {
		const kit: ReporterKit = {
			...makeKit("passthrough"),
			config: { ...makeKit("passthrough").config, githubActions: true },
		};
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		const output = reporter.render(makeInput(), kit);
		const summaryOutputs = output.filter((o) => o.target === "github-summary");
		// Vitest's own job-summary half is disabled, so an omitted block here
		// would leave a passing CI run with a blank step summary.
		expect(summaryOutputs).toHaveLength(1);
		expect(summaryOutputs[0]?.content).toContain("### Totals");
		expect(summaryOutputs[0]?.content).not.toContain("### Classifications");
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
			expect(content).toContain("### Totals");
			expect(content).not.toContain("### Classifications");
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

		it("includes a Stray output section with the human note's wording, the byte count and samples (issue #578)", () => {
			const strayOutput = {
				total: 5,
				stdout: 0,
				stderr: 5,
				bytes: 90,
				samples: [
					{ stream: "stderr" as const, text: "Preparing worktree (new branch 'x')" },
					{ stream: "stderr" as const, text: "HEAD is now at abc123" },
				],
			};
			// Run-level: both project reports carry the same value; it renders once.
			const content = renderSummary(
				makeInput({ reports: [makeReport({ project: "a", strayOutput }), makeReport({ project: "b", strayOutput })] }),
			);
			expect(content).toContain("### Stray output");
			expect(content).toContain(
				'Stray output: tests wrote 5 lines directly to stderr, bypassing Vitest\'s console capture. A child process with inherited stdio is the usual cause; pass `stdio: "pipe"`. 90 bytes recorded.',
			);
			expect(content).toContain("stderr: `Preparing worktree (new branch 'x')`");
			expect(content).toContain("(+3 more)");
			expect(content?.split("### Stray output")).toHaveLength(2);
		});

		it("omits the Stray output section when no report carries strayOutput", () => {
			const content = renderSummary(makeInput({ classifications: new Map([["t1", "flaky"]]) }));
			expect(content).not.toContain("Stray output");
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
		const output = consoleOutputs(reporter.render(makeInput({ reports }), kit));
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

describe("buildDispatchInputs", () => {
	it("buildDispatchInputs computes shape and outcome from the reduced state", () => {
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
	});

	it("buildDispatchInputs classifies workspace when more than one project report present", () => {
		const input = makeInput({
			reports: [makeReport({ project: "a" }), makeReport({ project: "b" })],
		});
		const inputs = buildDispatchInputs(initialRenderState, input);
		expect(inputs.shape).toBe("workspace");
		expect(inputs.projects).toHaveLength(2);
	});

	it("counts a timed-out test as timeoutCount, not failCount (issue #242)", () => {
		const report = makeReport({
			project: "demo",
			reason: "failed",
			summary: { total: 2, passed: 0, failed: 2, skipped: 0, duration: 20 },
			failed: [
				{
					file: "src/foo.test.ts",
					state: "failed",
					duration: 20,
					tests: [
						{
							name: "assertion failure",
							fullName: "assertion failure",
							state: "failed",
							errors: [{ message: "expected 1 to be 2" }],
						},
						{
							name: "timeout failure",
							fullName: "timeout failure",
							state: "failed",
							errors: [{ message: "Test timed out in 5000ms" }],
						},
					],
				},
			],
		});
		const inputs = buildDispatchInputs(initialRenderState, makeInput({ reports: [report] }));
		expect(inputs.projects).toHaveLength(1);
		const firstProject = inputs.projects[0];
		expect(firstProject).toBeDefined();
		if (firstProject === undefined) return;
		expect(firstProject.failCount).toBe(1);
		expect(firstProject.timeoutCount).toBe(1);
	});
});
