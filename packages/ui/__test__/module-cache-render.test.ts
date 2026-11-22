import type { DispatchInputs, RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/dispatcher/dispatch.js";
import { reduceRenderStateAll } from "../src/reducer.js";
import { renderAgent } from "../src/render-agent.js";

const STARTED = "2026-11-22T00:00:00.000Z";

const on = { enabled: true, transformMs: 1200, trackedMs: 60000, share: 0.02, modulesWritten: 14 };
const off = { enabled: false, transformMs: 250, trackedMs: 1000, share: 0.25 };
const ON_LINE = "Module cache: on · transform 1.2s (2%) · 14 modules written";

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

describe("module cache line", () => {
	it("renderAgent prints one unprefixed line for a single project", () => {
		const out = renderAgent(reduceRenderStateAll(finished({ moduleCache: [{ project: "app", moduleCache: on }] })));
		expect(out).toContain(`\n${ON_LINE}\n`);
	});

	it("renderAgent prefixes each line with its project when several report", () => {
		const out = renderAgent(
			reduceRenderStateAll(
				finished({
					moduleCache: [
						{ project: "app", moduleCache: on },
						{ project: "lib", moduleCache: off },
					],
				}),
			),
		);
		expect(out).toContain(`app: ${ON_LINE}`);
		expect(out).toContain("lib: Module cache: off · transform 250ms (25%)");
	});

	it("renderAgent prints nothing without data", () => {
		expect(renderAgent(reduceRenderStateAll(finished()))).not.toContain("Module cache");
	});

	it("dispatch appends the line after the cell's output", () => {
		const out = dispatch(inputs(finished({ moduleCache: [{ moduleCache: on }] })), {});
		expect(out).toContain(ON_LINE);
		expect(dispatch(inputs(finished()), {})).not.toContain("Module cache");
	});
});
