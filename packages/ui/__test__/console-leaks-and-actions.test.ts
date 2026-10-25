/**
 * Agent-mode output carries the two run-level signals issue #544 found
 * dropped: the suggested actions (fed through the synthesizer and appended
 * by the dispatcher) and the console leaks (folded from `RunFinished` like
 * stray output and rendered as a note).
 */

import type { AgentReport, ConsoleLeaks, DispatchInputs, RunEvent, SuggestedActionRecord } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/dispatcher/dispatch.js";
import { reduceRenderStateAll } from "../src/reducer.js";
import { renderAgent } from "../src/render-agent.js";
import { synthesizeFromAgentReport } from "../src/synthesize.js";

const STARTED = "2026-10-07T00:00:00.000Z";
const LEAK_NOTE = "Console leaks: passing tests wrote 3 console lines in 2 files";

const leaks: ConsoleLeaks = {
	total: 3,
	byFile: [
		{ file: "src/a.test.ts", stdout: 2, stderr: 0, tests: ["logs"], sample: "debug: starting" },
		{ file: "src/b.test.ts", stdout: 0, stderr: 1 },
	],
	fromFailingTests: { total: 4, files: 1 },
};

const actions: ReadonlyArray<SuggestedActionRecord> = [
	{
		severity: "warn",
		title: "Re-run the flaky test",
		detail: "pnpm vitest run src/a.test.ts",
		targetTool: "run_tests",
	},
	{ severity: "info", title: "Raise the line threshold", detail: "coverage is 12 points above target" },
];

const report = (overrides: Partial<AgentReport> = {}): AgentReport => ({
	timestamp: STARTED,
	reason: "passed",
	summary: { total: 3, passed: 3, failed: 0, skipped: 0, duration: 10, modules: 1 },
	failed: [],
	unhandledErrors: [],
	failedFiles: [],
	...overrides,
});

const finished = (extra: Partial<Extract<RunEvent, { _tag: "RunFinished" }>> = {}): ReadonlyArray<RunEvent> => [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
	{
		_tag: "ModuleFinished",
		modulePath: "a.test.ts",
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		timeoutCount: 0,
		durationMs: 10,
	},
	{
		_tag: "RunFinished",
		runId: "r",
		finishedAt: STARTED,
		passCount: 3,
		failCount: 0,
		skipCount: 0,
		durationMs: 10,
		collectedModules: 1,
		...extra,
	},
];

const inputs = (events: ReadonlyArray<RunEvent>): DispatchInputs => ({
	state: reduceRenderStateAll(events),
	shape: "single-project",
	outcome: "all-pass",
	projects: [],
	trend: null,
	belowTarget: [],
	runCommand: null,
});

const opts = {};

describe("console leaks (issue #544)", () => {
	it("folds RunFinished.consoleLeaks into the state, and a new run drops it", () => {
		expect(reduceRenderStateAll(finished({ consoleLeaks: leaks })).consoleLeaks).toEqual(leaks);
		const rerun = reduceRenderStateAll([
			...finished({ consoleLeaks: leaks }),
			{ _tag: "RunStarted", runId: "r2", startedAt: STARTED, configHash: "h" },
		]);
		expect(rerun.consoleLeaks).toBeUndefined();
	});

	it("synthesizes it from a report", () => {
		expect(reduceRenderStateAll(synthesizeFromAgentReport(report({ consoleLeaks: leaks }))).consoleLeaks).toEqual(
			leaks,
		);
		expect(reduceRenderStateAll(synthesizeFromAgentReport(report())).consoleLeaks).toBeUndefined();
	});

	it("renderAgent prints the note with the leaking files, and nothing without it", () => {
		const out = renderAgent(reduceRenderStateAll(finished({ consoleLeaks: leaks })));
		expect(out).toContain(LEAK_NOTE);
		expect(out).toContain("  src/a.test.ts (2 stdout): debug: starting");
		expect(out).toContain("  src/b.test.ts (1 stderr)");
		expect(out).toContain("  (4 more lines from failing tests in 1 file, not counted as leaks)");
		expect(renderAgent(reduceRenderStateAll(finished()))).not.toContain("Console leaks");
	});

	it("dispatch appends the note to every cell's output", () => {
		const out = dispatch(inputs(finished({ consoleLeaks: leaks })), opts);
		expect(out).toContain(LEAK_NOTE);
		expect(out).toContain("  src/b.test.ts (1 stderr)");
		expect(dispatch(inputs(finished()), opts)).not.toContain("Console leaks");
	});

	it("output from failing tests alone is not a leak and prints nothing", () => {
		const onlyFailing: ConsoleLeaks = { total: 0, byFile: [], fromFailingTests: { total: 2, files: 1 } };
		expect(dispatch(inputs(finished({ consoleLeaks: onlyFailing })), opts)).not.toContain("Console leaks");
	});
});

describe("suggested actions (issue #544)", () => {
	it("the synthesizer emits one SuggestedAction per option entry, before RunFinished", () => {
		const events = synthesizeFromAgentReport(report(), { suggestedActions: actions });
		const tags = events.map((e) => e._tag);
		expect(tags.filter((t) => t === "SuggestedAction")).toHaveLength(2);
		expect(tags.indexOf("SuggestedAction")).toBeLessThan(tags.indexOf("RunFinished"));
		expect(reduceRenderStateAll(events).suggestedActions).toEqual(actions);
	});

	it("dispatch appends a compact Actions list with the command and the tool", () => {
		const events = synthesizeFromAgentReport(report(), { suggestedActions: actions });
		const out = dispatch(inputs(events), opts);
		expect(out).toContain(
			["Actions:", "- warn: Re-run the flaky test (tool: run_tests)", "  pnpm vitest run src/a.test.ts"].join("\n"),
		);
		expect(out).toContain("- info: Raise the line threshold\n  coverage is 12 points above target");
		expect(dispatch(inputs(synthesizeFromAgentReport(report())), opts)).not.toContain("Actions:");
	});

	it("renderAgent prints the same list", () => {
		const out = renderAgent(reduceRenderStateAll(synthesizeFromAgentReport(report(), { suggestedActions: actions })));
		expect(out).toContain("Actions:\n- warn: Re-run the flaky test (tool: run_tests)\n  pnpm vitest run src/a.test.ts");
	});

	it("orders the trailers: actions, then stray output, then console leaks", () => {
		const events = synthesizeFromAgentReport(
			report({
				consoleLeaks: leaks,
				strayOutput: { total: 1, stdout: 0, stderr: 1, bytes: 5, samples: [{ stream: "stderr", text: "x" }] },
			}),
			{ suggestedActions: actions },
		);
		const out = dispatch(inputs(events), opts);
		const at = (needle: string) => out.indexOf(needle);
		expect(at("Actions:")).toBeGreaterThan(-1);
		expect(at("Actions:")).toBeLessThan(at("Stray output:"));
		expect(at("Stray output:")).toBeLessThan(at("Console leaks:"));
	});
});
