/**
 * Issue #741: the GitHub step summary and `summary.md` carry a Module cache
 * section built from each report's `moduleCache`, and `run.json` carries the
 * field on the reports it already writes.
 */

import type { AgentReport, ReporterKit, ReporterRenderInput, VitestAgentReporter } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { DefaultVitestAgentReporter } from "../src/defaultReporter.js";

const githubKit: ReporterKit = {
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
		detail: "standard",
		noColor: true,
		runCommand: "pnpm test",
	},
	stdEnv: "ci-github",
};

const report = (project: string, moduleCache?: AgentReport["moduleCache"]): AgentReport => ({
	timestamp: "2026-11-22T00:00:00.000Z",
	project,
	reason: "passed",
	summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 10 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...(moduleCache !== undefined && { moduleCache }),
});

const on = { enabled: true, transformMs: 1200, trackedMs: 60000, share: 0.02, modulesWritten: 14 };
const off = { enabled: false, transformMs: 250, trackedMs: 1000, share: 0.25 };

const render = (reports: ReadonlyArray<AgentReport>) => {
	const reporter = DefaultVitestAgentReporter(githubKit) as VitestAgentReporter;
	const input: ReporterRenderInput = { reports, classifications: new Map() };
	return reporter.render(input, githubKit);
};

describe("module cache in the GitHub summary", () => {
	it("adds a Module cache section with the line", () => {
		const summary = render([report("demo", on)]).find((o) => o.target === "github-summary")?.content;
		expect(summary).toContain("### Module cache");
		expect(summary).toContain("Module cache: on · transform 1.2s (2%) · 14 modules written");
	});

	it("prefixes each line with its project when several report", () => {
		const summary = render([report("app", on), report("lib", off)]).find((o) => o.target === "github-summary")?.content;
		expect(summary).toContain("app: Module cache: on");
		expect(summary).toContain("lib: Module cache: off · transform 250ms (25%)");
	});

	it("shows the same section in summary.md", () => {
		const md = render([report("demo", on)]).find((o) => o.target === "report" && o.filename === "summary.md")?.content;
		expect(md).toContain("### Module cache");
	});

	it("leaves the section out when no report has data", () => {
		const summary = render([report("demo")]).find((o) => o.target === "github-summary")?.content;
		expect(summary).not.toContain("Module cache");
	});

	it("lists every project's line in the agent console output of a multi-project run", () => {
		const agentKit: ReporterKit = { ...githubKit, config: { ...githubKit.config, consoleMode: "agent" } };
		const reporter = DefaultVitestAgentReporter(agentKit) as VitestAgentReporter;
		const input: ReporterRenderInput = {
			reports: [report("app", on), report("lib", off)],
			classifications: new Map(),
		};
		const stdout = reporter.render(input, agentKit).find((o) => o.target === "stdout")?.content;
		expect(stdout).toContain("app: Module cache: on · transform 1.2s (2%) · 14 modules written");
		expect(stdout).toContain("lib: Module cache: off · transform 250ms (25%)");
	});

	it("keeps the stat on the reports written to run.json", () => {
		const run = render([report("demo", on)]).find((o) => o.target === "report" && o.filename === "run.json")?.content;
		expect(JSON.parse(run ?? "{}").reports[0].moduleCache).toEqual(on);
	});
});
