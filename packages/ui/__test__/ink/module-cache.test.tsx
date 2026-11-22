import type { DispatchInputs, RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { dispatchInk } from "../../src/ink/dispatch-ink.js";
import { StreamApp } from "../../src/ink/StreamApp.js";
import { reduceRenderStateAll } from "../../src/reducer.js";
import { renderInk } from "../utils/render-ink.js";

const STARTED = "2026-11-22T00:00:00.000Z";
const LINE = "Module cache: on · transform 1.2s (2%) · 14 modules written";
const moduleCache = [
	{
		moduleCache: { enabled: true, transformMs: 1200, trackedMs: 60000, share: 0.02, modulesWritten: 14 },
	},
];

const finished = (extra: object = {}): ReadonlyArray<RunEvent> => [
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

describe("module cache line in the Ink renders", () => {
	it("dispatchInk shows the line after the cell, and nothing without data", async () => {
		const withData = dispatchInk(inputs(finished({ moduleCache })), {});
		const without = dispatchInk(inputs(finished()), {});
		expect((await renderInk(withData as NonNullable<typeof withData>, 200)).frame).toContain(LINE);
		expect((await renderInk(without as NonNullable<typeof without>, 200)).frame).not.toContain("Module cache");
	});

	it("the stream view's final frame shows the line", async () => {
		const { frame } = await renderInk(
			<StreamApp state={reduceRenderStateAll(finished({ moduleCache }))} frameIndex={0} nowMs={0} />,
			200,
		);
		expect(frame).toContain(LINE);
	});
});
