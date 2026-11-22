import type { AgentReport, RunEvent } from "@vitest-agent/sdk";
import { describe, expect, it } from "vitest";
import { reduceRenderStateAll } from "../src/reducer.js";
import { synthesizeFromAgentReport } from "../src/synthesize.js";

const STARTED = "2026-11-22T00:00:00.000Z";

const stat = { enabled: true, transformMs: 1200, trackedMs: 60000, share: 0.02, modulesWritten: 14 };

const finished = (extra: object = {}): ReadonlyArray<RunEvent> => [
	{ _tag: "RunStarted", runId: "r", startedAt: STARTED, configHash: "h" },
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

const moduleCacheOf = (events: ReadonlyArray<RunEvent>) => reduceRenderStateAll(events).moduleCache;

describe("module cache in the render state", () => {
	it("folds RunFinished.moduleCache into the state, and a new run drops it", () => {
		const entries = [{ project: "app", moduleCache: stat }];
		expect(moduleCacheOf(finished({ moduleCache: entries }))).toEqual(entries);
		const rerun = [
			...finished({ moduleCache: entries }),
			{ _tag: "RunStarted", runId: "r2", startedAt: STARTED, configHash: "h" } as const,
		];
		expect(moduleCacheOf(rerun)).toBeUndefined();
	});

	it("synthesizes the entry from a report that carries a stat", () => {
		const report = {
			timestamp: STARTED,
			project: "app",
			reason: "passed",
			summary: { total: 3, passed: 3, failed: 0, skipped: 0, duration: 10, modules: 1 },
			failed: [],
			unhandledErrors: [],
			failedFiles: [],
			moduleCache: stat,
		} satisfies AgentReport;
		expect(moduleCacheOf(synthesizeFromAgentReport(report))).toEqual([{ project: "app", moduleCache: stat }]);
	});

	it("leaves the state without it when the report has no stat", () => {
		expect(moduleCacheOf(finished())).toBeUndefined();
	});
});
