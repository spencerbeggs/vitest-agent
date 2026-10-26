// Parity cases ported verbatim from vitest@5.0.5
// test/unit/test/environment-diagnostics.test.ts and import-diagnostics.test.ts
// (same inputs, same expected outputs), plus threshold cases for the transform
// and isolate diagnostics derived from packages/vitest/src/node/reporters/base.ts.
import { describe, expect, it } from "vitest";
import {
	estimateModuleEvaluationSaving,
	formatTime,
	getEnvironmentDiagnostics,
	getImportDiagnostics,
	getIsolateDiagnostic,
	getTransformDiagnostics,
	isSavingWorthHinting,
} from "../src/utils/vitest-diagnostics.js";

const domProject = {
	name: "dom",
	environment: "jsdom",
	pool: "forks",
	isolate: true,
	browser: false,
	poolProvided: false,
	isolateProvided: false,
	environmentTime: 20_000,
	environmentCount: 40,
	trackedTime: 30_000,
	// estimated saving: 20s/8 - 20s/40 = 2s
	parallelism: 8,
	executionTime: 10_000,
};

describe("getEnvironmentDiagnostics", () => {
	it("fires for an isolating DOM project dominated by environment setup", () => {
		expect(getEnvironmentDiagnostics([domProject])).toEqual([
			{
				name: "dom",
				environment: "jsdom",
				environmentTime: 20_000,
				environmentCount: 40,
				share: 20_000 / 30_000,
				suggestIsolate: true,
			},
		]);
	});

	it("fires for happy-dom the same way", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, environment: "happy-dom" }])).toEqual([
			{
				name: "dom",
				environment: "happy-dom",
				environmentTime: 20_000,
				environmentCount: 40,
				share: 20_000 / 30_000,
				suggestIsolate: true,
			},
		]);
	});

	it("fires for the threads pool", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, pool: "threads" }])).toHaveLength(1);
	});

	it("fires exactly at the minimum time and share thresholds", () => {
		// 2s of setups over 8s of tracked time is exactly the 2s / 25% minimum;
		// saving: 2s/4 - 2s/40 = 450ms, above the 200ms (5% of 4s) floor
		expect(
			getEnvironmentDiagnostics([
				{
					...domProject,
					environmentTime: 2_000,
					trackedTime: 8_000,
					parallelism: 4,
					executionTime: 4_000,
				},
			]),
		).toHaveLength(1);
	});

	it("fires for a serial run - all setups but one are avoidable", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, parallelism: 1 }])).toHaveLength(1);
	});

	it("reports every affected project with its own numbers", () => {
		const components = {
			...domProject,
			name: "components",
			environment: "happy-dom",
			environmentTime: 9_000,
			environmentCount: 30,
			trackedTime: 12_000,
		};
		expect(getEnvironmentDiagnostics([domProject, components])).toEqual([
			{
				name: "dom",
				environment: "jsdom",
				environmentTime: 20_000,
				environmentCount: 40,
				share: 20_000 / 30_000,
				suggestIsolate: true,
			},
			{
				name: "components",
				environment: "happy-dom",
				environmentTime: 9_000,
				environmentCount: 30,
				share: 9_000 / 12_000,
				suggestIsolate: true,
			},
		]);
	});

	it("does not suggest disabling isolation the user explicitly enabled", () => {
		const diagnostics = getEnvironmentDiagnostics([{ ...domProject, isolateProvided: true }]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].suggestIsolate).toBe(false);
	});

	it("stays quiet when the user explicitly configured the pool", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, poolProvided: true }])).toEqual([]);
	});

	it("stays quiet for vm pools - the environment is already per worker", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, pool: "vmThreads", isolate: false }])).toEqual([]);
	});

	it("stays quiet without isolation - the environment is already per worker", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, isolate: false }])).toEqual([]);
	});

	it("stays quiet for the node environment", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, environment: "node" }])).toEqual([]);
	});

	it("stays quiet for browser projects", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, browser: true }])).toEqual([]);
	});

	it("stays quiet when the setup cost is small in absolute terms", () => {
		expect(
			getEnvironmentDiagnostics([
				{
					...domProject,
					environmentTime: 1_000,
					trackedTime: 1_200,
				},
			]),
		).toEqual([]);
	});

	it("stays quiet when the setup cost is small relative to the run", () => {
		expect(
			getEnvironmentDiagnostics([
				{
					...domProject,
					environmentTime: 3_000,
					trackedTime: 60_000,
				},
			]),
		).toEqual([]);
	});

	it("stays quiet for a single file - there is nothing to amortize", () => {
		expect(getEnvironmentDiagnostics([{ ...domProject, environmentCount: 1 }])).toEqual([]);
	});

	it("stays quiet when the saving is negligible relative to a long run", () => {
		// ~2s estimated saving is below 5% of a 5-minute run and below 10s absolute
		expect(getEnvironmentDiagnostics([{ ...domProject, executionTime: 300_000 }])).toEqual([]);
	});

	it("fires on long runs when the absolute saving is large", () => {
		// 100s/8 - 100s/50 = 10.5s: only 2.6% of the run, but 10s+ is worth attention
		expect(
			getEnvironmentDiagnostics([
				{
					...domProject,
					environmentTime: 100_000,
					environmentCount: 50,
					trackedTime: 150_000,
					executionTime: 400_000,
				},
			]),
		).toHaveLength(1);
	});

	it("reports only the affected projects", () => {
		const diagnostics = getEnvironmentDiagnostics([domProject, { ...domProject, name: "unit", environment: "node" }]);
		expect(diagnostics.map((diagnostic) => diagnostic.name)).toEqual(["dom"]);
	});
});

describe("isSavingWorthHinting", () => {
	it("requires a quarter of a second in absolute terms", () => {
		expect(isSavingWorthHinting(200, 1_000)).toBe(false);
	});

	it("accepts savings above 5% of the run", () => {
		expect(isSavingWorthHinting(300, 1_000)).toBe(true);
		expect(isSavingWorthHinting(500, 10_000)).toBe(true);
	});

	it("rejects savings below the noise floor of a long run", () => {
		expect(isSavingWorthHinting(300, 60_000)).toBe(false);
	});

	it("accepts 10s+ savings regardless of percentage", () => {
		expect(isSavingWorthHinting(12_000, 400_000)).toBe(true);
	});
});

// the barrel-file shape: 20 test files that each re-evaluate the same
// 800-module graph to use a few symbols from it
const barrelProject = {
	name: "barrel",
	pool: "forks",
	isolate: true,
	browser: false,
	isolateProvided: false,
	importTime: 15_000,
	trackedTime: 20_000,
	fetchCounts: Array.from({ length: 800 }, () => 20),
	fileCount: 20,
	// duplication: (20 - 8) / 20 = 0.6, estimated saving: 15s * 0.6 / 8 = 1.125s
	parallelism: 8,
	executionTime: 4_000,
};

describe("getImportDiagnostics", () => {
	it("fires when test files repeatedly evaluate a shared module graph", () => {
		expect(getImportDiagnostics([barrelProject])).toEqual([
			{
				name: "barrel",
				importTime: 15_000,
				share: 15_000 / 20_000,
				totalFetches: 16_000,
				uniqueModules: 800,
				duplication: 0.6,
				estimatedSaving: (15_000 * 0.6) / 8,
			},
		]);
	});

	it("fires for the threads pool", () => {
		expect(getImportDiagnostics([{ ...barrelProject, pool: "threads" }])).toHaveLength(1);
	});

	it("counts only the fetches above the worker parallelism as avoidable", () => {
		// 100 modules fetched 20 times (12 avoidable each on 8 lanes) and 100
		// fetched twice (0 avoidable): duplication = 1200 / 2200
		const fetchCounts = [...Array.from({ length: 100 }, () => 20), ...Array.from({ length: 100 }, () => 2)];
		expect(getImportDiagnostics([{ ...barrelProject, fetchCounts }])).toEqual([
			{
				name: "barrel",
				importTime: 15_000,
				share: 15_000 / 20_000,
				totalFetches: 2_200,
				uniqueModules: 200,
				duplication: 1_200 / 2_200,
				estimatedSaving: (15_000 * (1_200 / 2_200)) / 8,
			},
		]);
	});

	it("fires exactly at the minimum duplication", () => {
		// 10 fetches per module on 8 lanes: duplication (10 - 8) / 10 = 0.2
		expect(
			getImportDiagnostics([
				{
					...barrelProject,
					fetchCounts: Array.from({ length: 800 }, () => 10),
				},
			]),
		).toHaveLength(1);
	});

	it("fires exactly at the minimum import time and share", () => {
		// 2s of imports over 8s of tracked time is exactly the 2s / 25% minimum;
		// saving on 4 lanes: 2s * 0.8 / 4 = 400ms, above the 250ms floor
		expect(
			getImportDiagnostics([
				{
					...barrelProject,
					importTime: 2_000,
					trackedTime: 8_000,
					parallelism: 4,
				},
			]),
		).toHaveLength(1);
	});

	it("treats every repeated fetch as avoidable on a single lane", () => {
		const diagnostics = getImportDiagnostics([{ ...barrelProject, parallelism: 1 }]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].duplication).toBe(19 / 20);
		expect(diagnostics[0].estimatedSaving).toBe(15_000 * (19 / 20));
	});

	it("reports every affected project", () => {
		const diagnostics = getImportDiagnostics([barrelProject, { ...barrelProject, name: "ui" }]);
		expect(diagnostics.map((diagnostic) => diagnostic.name)).toEqual(["barrel", "ui"]);
	});

	it("stays quiet for disjoint per-file graphs - reused workers would not help", () => {
		// every module belongs to one or two test files: no fetch count exceeds
		// the parallelism, so nothing is re-evaluated beyond what lanes require
		expect(
			getImportDiagnostics([
				{
					...barrelProject,
					fetchCounts: Array.from({ length: 800 }, (_, i) => (i % 2 === 0 ? 1 : 2)),
				},
			]),
		).toEqual([]);
	});

	it("stays quiet when the tests dominate the run", () => {
		expect(
			getImportDiagnostics([
				{
					...barrelProject,
					importTime: 2_500,
					trackedTime: 30_000,
				},
			]),
		).toEqual([]);
	});

	it("stays quiet when the import time is small in absolute terms", () => {
		expect(
			getImportDiagnostics([
				{
					...barrelProject,
					importTime: 1_500,
					trackedTime: 2_000,
				},
			]),
		).toEqual([]);
	});

	it("does not suggest disabling isolation the user explicitly enabled", () => {
		expect(getImportDiagnostics([{ ...barrelProject, isolateProvided: true }])).toEqual([]);
	});

	it("stays quiet without isolation - the graph is already shared", () => {
		expect(getImportDiagnostics([{ ...barrelProject, isolate: false }])).toEqual([]);
	});

	it("stays quiet for vm pools - they re-create the graph per context regardless", () => {
		expect(getImportDiagnostics([{ ...barrelProject, pool: "vmThreads" }])).toEqual([]);
	});

	it("stays quiet for browser projects", () => {
		expect(getImportDiagnostics([{ ...barrelProject, browser: true }])).toEqual([]);
	});

	it("stays quiet when files do not outnumber the workers", () => {
		expect(getImportDiagnostics([{ ...barrelProject, fileCount: 8 }])).toEqual([]);
	});

	it("stays quiet when the saving is negligible relative to a long run", () => {
		// ~1.1s estimated saving is below 5% of a 5-minute run and below 10s absolute
		expect(getImportDiagnostics([{ ...barrelProject, executionTime: 300_000 }])).toEqual([]);
	});
});

const coldProject = {
	name: "cold",
	transformTime: 8_000,
	trackedTime: 20_000,
	fsModuleCache: false,
	fsModuleCacheProvided: false,
	executionTime: 10_000,
};

describe("getTransformDiagnostics", () => {
	it("fires when transforms dominate and nothing persists them", () => {
		expect(getTransformDiagnostics([coldProject])).toEqual([
			{
				name: "cold",
				transformTime: 8_000,
				share: 8_000 / 20_000,
			},
		]);
	});

	it("stays quiet when the fs module cache is already enabled", () => {
		expect(getTransformDiagnostics([{ ...coldProject, fsModuleCache: true }])).toEqual([]);
	});

	it("does not suggest a cache the user explicitly configured away", () => {
		expect(getTransformDiagnostics([{ ...coldProject, fsModuleCacheProvided: true }])).toEqual([]);
	});

	it("stays quiet when the transform time is small in absolute terms", () => {
		expect(getTransformDiagnostics([{ ...coldProject, transformTime: 1_500 }])).toEqual([]);
	});

	it("stays quiet when the tests dominate the run", () => {
		expect(
			getTransformDiagnostics([
				{
					...coldProject,
					transformTime: 3_000,
					trackedTime: 30_000,
				},
			]),
		).toEqual([]);
	});

	it("stays quiet when the saving is negligible relative to a long run", () => {
		expect(
			getTransformDiagnostics([
				{
					...coldProject,
					transformTime: 2_500,
					trackedTime: 9_000,
					executionTime: 300_000,
				},
			]),
		).toEqual([]);
	});
});

describe("estimateModuleEvaluationSaving", () => {
	it("spreads the avoidable evaluations across the worker lanes", () => {
		// a module evaluated by 20 files at 10ms each on 8 lanes keeps 8
		// evaluations: (200 * 12/20) / 8 = 15ms saved per module
		const modules = Array.from({ length: 10 }, () => Array.from({ length: 20 }, () => 10));
		expect(estimateModuleEvaluationSaving(modules, 8)).toBe(150);
	});

	it("saves nothing when no module is evaluated more often than the lanes", () => {
		const modules = [Array.from({ length: 8 }, () => 10), [10, 10]];
		expect(estimateModuleEvaluationSaving(modules, 8)).toBe(0);
	});

	it("treats every evaluation past the first as avoidable on a single lane", () => {
		expect(estimateModuleEvaluationSaving([[10, 10, 10, 10]], 1)).toBe(30);
	});
});

// Threshold cases for the transform diagnostic (MIN_TRANSFORM_TIME = 2s,
// MIN_TRANSFORM_SHARE = 25%), one just below and one at/above each.
describe("getTransformDiagnostics thresholds", () => {
	const atThreshold = {
		name: "edge",
		transformTime: 2_000,
		trackedTime: 8_000,
		fsModuleCache: false,
		fsModuleCacheProvided: false,
		executionTime: 10_000,
	};

	it("fires exactly at the minimum transform time and share", () => {
		expect(getTransformDiagnostics([atThreshold])).toEqual([{ name: "edge", transformTime: 2_000, share: 0.25 }]);
	});

	it("stays quiet just below the minimum transform time", () => {
		expect(getTransformDiagnostics([{ ...atThreshold, transformTime: 1_999, trackedTime: 7_996 }])).toEqual([]);
	});

	it("stays quiet just below the minimum share", () => {
		expect(getTransformDiagnostics([{ ...atThreshold, trackedTime: 8_001 }])).toEqual([]);
	});

	it("stays quiet with no tracked time", () => {
		expect(getTransformDiagnostics([{ ...atThreshold, trackedTime: 0 }])).toEqual([]);
	});
});

// The isolate computation extracted from BaseReporter.reportIsolateDiagnostic.
// 20 workers, 20 files, maxWorkers 4: parallelism 4, avg startup 200ms, wall
// startup 1000ms, saving 1000 - 200 = 800ms.
const isolateRun = {
	numWorkers: 20,
	isolates: true,
	numFiles: 20,
	startupTime: 4_000,
	maxWorkers: 4,
	measuresModules: false,
	moduleSelfTimes: [] as number[][],
	executionTime: 16_000,
};

describe("getIsolateDiagnostic", () => {
	it("fires exactly at 5% of the run", () => {
		expect(getIsolateDiagnostic(isolateRun)).toEqual({
			numWorkers: 20,
			avgStartup: 200,
			estimatedSaving: 800,
			measuresModules: false,
		});
	});

	it("stays quiet just below 5% of the run", () => {
		expect(getIsolateDiagnostic({ ...isolateRun, executionTime: 16_001 })).toBeUndefined();
	});

	it("stays quiet below the 250ms floor", () => {
		// parallelism 4, avg 49ms, wall 245ms: saving 196ms
		expect(getIsolateDiagnostic({ ...isolateRun, startupTime: 980, executionTime: 1_000 })).toBeUndefined();
	});

	it("stays quiet when no project isolates without an explicit choice", () => {
		expect(getIsolateDiagnostic({ ...isolateRun, isolates: false })).toBeUndefined();
	});

	it("stays quiet when no workers were spawned", () => {
		expect(getIsolateDiagnostic({ ...isolateRun, numWorkers: 0 })).toBeUndefined();
	});

	it("stays quiet when workers do not outnumber the parallelism", () => {
		expect(getIsolateDiagnostic({ ...isolateRun, numWorkers: 4, startupTime: 100_000 })).toBeUndefined();
	});

	it("adds module evaluation savings when import durations are measured", () => {
		// 10 modules x 20 files x 10ms on 4 lanes: (200 * 16/20) / 4 = 40ms each
		const moduleSelfTimes = Array.from({ length: 10 }, () => Array.from({ length: 20 }, () => 10));
		expect(getIsolateDiagnostic({ ...isolateRun, measuresModules: true, moduleSelfTimes })).toEqual({
			numWorkers: 20,
			avgStartup: 200,
			estimatedSaving: 1_200,
			measuresModules: true,
		});
	});
});

describe("formatTime", () => {
	it("formats sub-second times as rounded milliseconds", () => {
		expect(formatTime(412.4)).toBe("412ms");
		expect(formatTime(1_000)).toBe("1000ms");
	});

	it("formats times over a second with two decimals", () => {
		expect(formatTime(31_200)).toBe("31.20s");
		expect(formatTime(1_001)).toBe("1.00s");
	});
});
