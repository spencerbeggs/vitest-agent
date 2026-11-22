/**
 * Issue #741: `onTestRunEnd` derives each project's module cache stat from
 * Vitest's per-file fetch durations and the cache directory's writes, and
 * attaches it to that project's `AgentReport` for every renderer.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryFileSystem } from "@effected/memfs";
import type { ReporterRenderInput, RunEvent, VitestTestCase, VitestTestModule } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentReporterConstructorOptions } from "../src/reporter.js";
import { AgentReporter } from "../src/reporter.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

const module = (name: string, project = ""): VitestTestModule => {
	const test: VitestTestCase = {
		type: "test",
		name: `${name} test`,
		fullName: `${name} test`,
		tags: [],
		result: () => ({ state: "passed" }),
		diagnostic: () => ({ duration: 1, flaky: false, slow: false }),
	};
	return {
		type: "module",
		moduleId: `/abs/src/${name}.test.ts`,
		relativeModuleId: `src/${name}.test.ts`,
		project: { name: project },
		state: () => "passed",
		children: {
			*allTests() {
				yield test;
			},
			*allSuites() {},
		},
		diagnostic: () => ({ duration: 1 }),
		errors: () => [],
	};
};

const KEY = (c: string): string => c.repeat(40);

/** A volume whose two entries were written "during" any run that starts now. */
const freshCache = () => {
	const future = Date.now() + 60_000;
	return seedMemfsWalker("/cache", {
		[KEY("a")]: MemoryFileSystem.file("x", { mtime: future }),
		[KEY("b")]: MemoryFileSystem.file("x", { mtime: future }),
		[KEY("c")]: MemoryFileSystem.file("x", { mtime: 1_000 }),
		"_manifest-root-1.json": MemoryFileSystem.file(
			JSON.stringify({
				name: "",
				root: "/repo",
				modules: { node: { "/a.ts": KEY("a"), "/b.ts": KEY("b"), "/c.ts": KEY("c") } },
			}),
			{ mtime: future },
		),
	});
};

const fakeVitest = (files: object[]) => ({
	config: { watch: false },
	projects: [{ name: "", config: { fsModuleCache: true, root: "/repo" } }],
	state: { getFiles: () => files },
	cache: { _modules: { getCacheRoot: () => "/cache" } },
});

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "vitest-agent-module-cache-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

const makeReporter = (extra: Partial<AgentReporterConstructorOptions> = {}) => {
	const inputs: ReporterRenderInput[] = [];
	const options = {
		cacheDir: tmp,
		consoleMode: "silent",
		moduleCacheOps: freshCache(),
		...extra,
		reporter: () => ({
			render: (input: ReporterRenderInput) => {
				inputs.push(input);
				return [];
			},
		}),
	} as AgentReporterConstructorOptions;
	return { reporter: new AgentReporter(options), inputs };
};

describe("AgentReporter module cache (#741)", () => {
	it("attaches the project's module cache stat to its report", async () => {
		// Given: a project whose files spent 200ms of 2000ms tracked time fetching, and two fresh cache entries
		const { reporter, inputs } = makeReporter();
		await reporter.onInit(
			fakeVitest([
				{
					projectName: "",
					setupFetchDuration: 100,
					collectFetchDuration: 100,
					collectDuration: 1000,
					result: { duration: 1000 },
				},
			]) as never,
		);
		reporter.onTestRunStart([]);

		// When: the run ends
		await reporter.onTestRunEnd([module("a")], [], "passed");

		// Then: the report carries the stat
		expect(inputs[0]?.reports[0]?.moduleCache).toEqual({
			enabled: true,
			transformMs: 200,
			trackedMs: 2000,
			share: 0.1,
			modulesWritten: 2,
		});
	});

	it("carries the stat on the live RunFinished event for the renderers", async () => {
		const events: RunEvent[] = [];
		const { reporter } = makeReporter({ onRunEvent: (e) => events.push(e) });
		await reporter.onInit(
			fakeVitest([
				{
					projectName: "",
					setupFetchDuration: 100,
					collectFetchDuration: 100,
					collectDuration: 1000,
					result: { duration: 1000 },
				},
			]) as never,
		);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const finished = events.find((e) => e._tag === "RunFinished") as { moduleCache?: unknown } | undefined;
		expect(finished?.moduleCache).toEqual([
			{ moduleCache: { enabled: true, transformMs: 200, trackedMs: 2000, share: 0.1, modulesWritten: 2 } },
		]);
	});

	it("persists the stat on the project's test_runs row", async () => {
		const { reporter } = makeReporter();
		await reporter.onInit(
			fakeVitest([
				{
					projectName: "",
					setupFetchDuration: 100,
					collectFetchDuration: 100,
					collectDuration: 1000,
					result: { duration: 1000 },
				},
			]) as never,
		);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");

		const db = new DatabaseSync(join(tmp, "data.db"), { readOnly: true });
		try {
			expect(
				db
					.prepare(
						"SELECT module_cache_enabled AS enabled, module_cache_transform_ms AS transformMs, module_cache_tracked_ms AS trackedMs, module_cache_modules_written AS written FROM test_runs",
					)
					.all(),
			).toEqual([{ enabled: 1, transformMs: 200, trackedMs: 2000, written: 2 }]);
		} finally {
			db.close();
		}
	});

	it("leaves the report without a stat when the run has no timing data", async () => {
		const { reporter, inputs } = makeReporter();
		await reporter.onInit(fakeVitest([]) as never);
		reporter.onTestRunStart([]);
		await reporter.onTestRunEnd([module("a")], [], "passed");
		expect(inputs[0]?.reports[0]).not.toHaveProperty("moduleCache");
	});
});
