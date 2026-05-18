/**
 * Integration tests for the default reporter.
 *
 * The factory consumes a `ReporterKit` and returns a reporter whose
 * `render(input, kit)` produces one stdout-targeted `RenderedOutput`
 * carrying the dispatched agent-string. These tests build the kit /
 * input directly without threading through the plugin so the reporter's
 * contract is exercised in isolation.
 */

import { describe, expect, it } from "vitest";
import type { AgentReport, ReporterKit, ReporterRenderInput, VitestAgentReporter } from "vitest-agent-sdk";
import { initialRenderState } from "vitest-agent-sdk";
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

	it("emits nothing for consoleMode=ink", () => {
		const kit = makeKit("ink");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
	});

	it("emits nothing for consoleMode=ci-annotations", () => {
		const kit = makeKit("ci-annotations");
		const reporter = asSingle(DefaultVitestAgentReporter(kit));
		expect(reporter.render(makeInput(), kit)).toEqual([]);
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
