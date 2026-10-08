import type { AgentReport, DispatchInputs, RunEvent, StrayOutput } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { dispatch } from "../../src/dispatcher/dispatch.js";
import { StreamApp } from "../../src/ink/StreamApp.js";
import { reduceRenderStateAll } from "../../src/reducer.js";
import { renderAgent } from "../../src/render-agent.js";
import { synthesizeFromAgentReport } from "../../src/synthesize.js";
import { renderInk } from "../utils/render-ink.js";

const STARTED = "2026-10-07T00:00:00.000Z";
const NOTE = "Stray output: tests wrote 2 lines directly to stderr";

const stray: StrayOutput = {
	total: 2,
	stdout: 0,
	stderr: 2,
	bytes: 60,
	samples: [
		{ stream: "stderr", text: "Preparing worktree (new branch 'x')" },
		{ stream: "stderr", text: "HEAD is now at abc123" },
	],
};

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

describe("stray output", () => {
	it("folds RunFinished.strayOutput into the state, and a new run drops it", () => {
		expect(reduceRenderStateAll(finished({ strayOutput: stray })).strayOutput).toEqual(stray);
		const rerun = reduceRenderStateAll([
			...finished({ strayOutput: stray }),
			{ _tag: "RunStarted", runId: "r2", startedAt: STARTED, configHash: "h" },
		]);
		expect(rerun.strayOutput).toBeUndefined();
	});

	it("synthesizes it from a report", () => {
		const report: AgentReport = {
			timestamp: STARTED,
			reason: "passed",
			summary: { total: 3, passed: 3, failed: 0, skipped: 0, duration: 10, modules: 1 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
			strayOutput: stray,
		};
		expect(reduceRenderStateAll(synthesizeFromAgentReport(report)).strayOutput).toEqual(stray);
	});

	it("renderAgent prints the note with samples, and nothing without it", () => {
		const out = renderAgent(reduceRenderStateAll(finished({ strayOutput: stray })));
		expect(out).toContain(NOTE);
		expect(out).toContain("  stderr: Preparing worktree (new branch 'x')");
		expect(renderAgent(reduceRenderStateAll(finished()))).not.toContain("Stray output");
	});

	it("dispatch appends the note to every cell's output", () => {
		const out = dispatch(inputs(finished({ strayOutput: stray })), { noColor: true, osc8: (_u, l) => l });
		expect(out).toContain(NOTE);
		expect(out).toContain("  stderr: HEAD is now at abc123");
		expect(dispatch(inputs(finished()), { noColor: true, osc8: (_u, l) => l })).not.toContain("Stray output");
	});

	it("the stream view's final frame shows the note", () => {
		const { frame, cleanup } = renderInk(
			<StreamApp state={reduceRenderStateAll(finished({ strayOutput: stray }))} frameIndex={0} nowMs={0} />,
			200,
		);
		expect(frame).toContain(NOTE);
		expect(frame).toContain("stderr: Preparing worktree (new branch 'x')");
		cleanup();
	});
});
