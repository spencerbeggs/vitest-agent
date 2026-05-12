import { describe, expect, it } from "vitest";
import type {
	AgentReport,
	ConsoleMode,
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	VitestAgentReporterFactory,
} from "vitest-agent-sdk";
import { eventSourcedReporter, makeEventSourcedReporter } from "../src/factory/EventSourcedReporterFactory.js";

const renderViaFactory = (
	factory: VitestAgentReporterFactory,
	kit: ReporterKit,
	input: ReporterRenderInput,
): ReadonlyArray<RenderedOutput> => {
	const reporter = factory(kit);
	const reporters = Array.isArray(reporter) ? reporter : [reporter];
	return reporters.flatMap((r) => r.render(input));
};

const reportFixture: AgentReport = {
	timestamp: "2026-05-12T00:00:00.000Z",
	reason: "failed",
	summary: { total: 4, passed: 2, failed: 1, skipped: 1, duration: 100 },
	failed: [
		{
			file: "src/math.test.ts",
			state: "failed",
			duration: 14,
			tests: [
				{
					name: "divides",
					fullName: "math > divides",
					state: "failed",
					duration: 7,
					errors: [{ message: "expected 0.5 to equal 0.5000001", diff: "- 0.5000001\n+ 0.5" }],
					classification: "new-failure",
				},
			],
		},
	],
	unhandledErrors: [],
	failedFiles: ["src/math.test.ts"],
};

const buildKit = (consoleMode: ConsoleMode): ReporterKit => ({
	config: {
		consoleMode,
		executor: consoleMode === "agent" ? "agent" : consoleMode === "ci-annotations" ? "ci" : "human",
		mcp: false,
		consoleOutput: "failures",
		omitPassingTests: true,
		coverageConsoleLimit: 20,
		includeBareZero: false,
		githubActions: false,
		githubSummary: false,
		format: "terminal",
		detail: "neutral",
		noColor: true,
		coverageThresholds: {
			global: {},
			perFile: false,
			patterns: [],
		},
	},
	stdEnv: "terminal",
	stdOsc8: (_url, label) => label,
});

const inputOf = (reports: AgentReport[]): ReporterRenderInput => ({
	reports,
	classifications: new Map(),
});

describe("eventSourcedReporter — mode dispatch", () => {
	it("agent mode emits one stdout RenderedOutput with the markdown-flavored frame", () => {
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("agent"), inputOf([reportFixture]));
		expect(outputs).toHaveLength(1);
		expect(outputs[0]?.target).toBe("stdout");
		expect(outputs[0]?.content).toContain("Tests: 2/4 passed, 1 failed, 1 skipped (100ms)");
		expect(outputs[0]?.content).toContain("[new-failure]");
		expect(outputs[0]?.content.endsWith("\n")).toBe(true);
	});

	it("ink mode emits no static output — the live Ink mount owns visible rendering", () => {
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("ink"), inputOf([reportFixture]));
		expect(outputs).toEqual([]);
	});

	it("silent mode emits no output", () => {
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("silent"), inputOf([reportFixture]));
		expect(outputs).toEqual([]);
	});

	it("passthrough mode emits no output (the plugin's default-factory path lets Vitest render)", () => {
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("passthrough"), inputOf([reportFixture]));
		expect(outputs).toEqual([]);
	});

	it("ci-annotations mode emits no output — a dedicated CI reporter owns that channel", () => {
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("ci-annotations"), inputOf([reportFixture]));
		expect(outputs).toEqual([]);
	});
});

describe("eventSourcedReporter — multi-project", () => {
	it("emits one RenderedOutput per report", () => {
		const second: AgentReport = {
			...reportFixture,
			summary: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 5 },
			failed: [],
			failedFiles: [],
			reason: "passed",
		};
		const outputs = renderViaFactory(eventSourcedReporter, buildKit("agent"), inputOf([reportFixture, second]));
		expect(outputs).toHaveLength(2);
		expect(outputs[0]?.content).toContain("1 failed");
		expect(outputs[1]?.content).toContain("Tests: 1/1 passed");
	});
});

describe("makeEventSourcedReporter — options", () => {
	it("modeOverride takes precedence over kit.config.mode", () => {
		const factory = makeEventSourcedReporter({ modeOverride: "silent" });
		const outputs = renderViaFactory(factory, buildKit("agent"), inputOf([reportFixture]));
		expect(outputs).toEqual([]);
	});

	it("width is threaded through to the agent renderer", () => {
		const factory = makeEventSourcedReporter({ width: 120 });
		const outputs = renderViaFactory(factory, buildKit("agent"), inputOf([reportFixture]));
		expect(outputs).toHaveLength(1);
		expect(outputs[0]?.content).toContain("Tests: 2/4 passed");
	});
});

describe("eventSourcedReporter — determinism", () => {
	it("emits byte-identical content across repeat calls", () => {
		const a = renderViaFactory(eventSourcedReporter, buildKit("agent"), inputOf([reportFixture]));
		const b = renderViaFactory(eventSourcedReporter, buildKit("agent"), inputOf([reportFixture]));
		expect(a[0]?.content).toBe(b[0]?.content);
	});
});
