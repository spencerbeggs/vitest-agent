import { MemoryFileSystem } from "@effected/memfs";
import type { WalkerSyncOps } from "@effected/walker";
import { describe, expect, it } from "vitest";
import { collectModuleCacheStats } from "../src/utils/module-cache-stats.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

const collect = (vitest: object, startMs: number, ops: WalkerSyncOps) => collectModuleCacheStats(vitest, startMs, ops);

const KEY = (c: string): string => c.repeat(40);

interface FakeFile {
	projectName: string;
	setupFetchDuration?: number;
	collectFetchDuration?: number;
	environmentLoad?: number;
	setupDuration?: number;
	collectDuration?: number;
	prepareDuration?: number;
	result?: { duration?: number };
}

const fakeVitest = (files: FakeFile[], projectConfig: Record<string, unknown> = {}, extra: object = {}) => ({
	config: { watch: false },
	projects: [{ name: "app", config: { fsModuleCache: true, ...projectConfig } }],
	state: { getFiles: () => files },
	cache: { _modules: { getCacheRoot: () => "/cache" } },
	...extra,
});

const ops = (): WalkerSyncOps =>
	seedMemfsWalker("/cache", {
		[KEY("a")]: MemoryFileSystem.file("x", { mtime: 5_000 }),
		[KEY("b")]: MemoryFileSystem.file("x", { mtime: 5_000 }),
		[KEY("c")]: MemoryFileSystem.file("x", { mtime: 1_000 }),
	});

const files: FakeFile[] = [
	{
		projectName: "app",
		setupFetchDuration: 100,
		collectFetchDuration: 200,
		setupDuration: 300,
		collectDuration: 400,
		result: { duration: 300 },
	},
	{
		projectName: "app",
		setupFetchDuration: 50,
		collectFetchDuration: 150,
		collectDuration: 500,
		result: { duration: 500 },
	},
];

describe("collectModuleCacheStats", () => {
	it("should sum fetch durations over tracked time and count the modules written", () => {
		// Given: two files (transform 500ms of 2000ms tracked) and two fresh cache entries
		// When: collecting at a run start of 4000
		const stats = collect(fakeVitest(files), 4_000, ops());

		// Then: the project's stat carries the sums, the 25% share and the writes
		expect(stats.get("app")).toEqual({
			enabled: true,
			transformMs: 500,
			trackedMs: 2000,
			share: 0.25,
			modulesWritten: 2,
		});
	});

	it("should report the cache off with no written count", () => {
		const stats = collect(fakeVitest(files, { fsModuleCache: false }), 4_000, ops());
		expect(stats.get("app")).toEqual({ enabled: false, transformMs: 500, trackedMs: 2000, share: 0.25 });
	});

	it("should use the project's own fsModuleCachePath when Vitest's cache root is not reachable", () => {
		const vitest = { ...fakeVitest(files, { fsModuleCachePath: "/cache" }), cache: undefined };
		const stats = collect(vitest, 4_000, ops());
		expect(stats.get("app")?.modulesWritten).toBe(2);
	});

	it("should omit modulesWritten when no cache directory can be resolved", () => {
		const vitest = { ...fakeVitest(files), cache: undefined };
		const stats = collect(vitest, 4_000, ops());
		expect(stats.get("app")).not.toHaveProperty("modulesWritten");
	});

	it("should omit a project with no tracked time, and everything for merged blob reports", () => {
		expect(collect(fakeVitest([{ projectName: "app" }]), 0, ops()).size).toBe(0);
		expect(collect(fakeVitest(files, {}, { state: { getFiles: () => files, blobs: {} } }), 0, ops()).size).toBe(0);
	});
});
