// Issue 741: a project's module cache stat persists on its `test_runs` row and
// reads back through `DataReader`, so triage and history can show a cold run
// against a warm one.

import type { ModuleCacheStat } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReader } from "../src/services/DataReader.js";
import type { TestRunInput } from "../src/services/DataStore.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(":memory:")));

const COLD: ModuleCacheStat = { enabled: true, transformMs: 4000, trackedMs: 10000, share: 0.4, modulesWritten: 120 };
const WARM: ModuleCacheStat = { enabled: true, transformMs: 300, trackedMs: 6000, share: 0.05, modulesWritten: 0 };
const OFF: ModuleCacheStat = { enabled: false, transformMs: 900, trackedMs: 3000, share: 0.3 };

const runInput = (
	overrides: Partial<TestRunInput> & Pick<TestRunInput, "invocationId" | "timestamp">,
	moduleCache?: ModuleCacheStat | null,
): TestRunInput => ({
	project: "app",
	settingsHash: "h",
	commitSha: null,
	branch: null,
	reason: "passed",
	duration: 1,
	total: 1,
	passed: 1,
	failed: 0,
	skipped: 0,
	scoped: false,
	...(moduleCache !== undefined && moduleCache !== null && { moduleCache }),
	...overrides,
});

const seed = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", { vitestVersion: "5.1.1" }, {});
	return store;
});

describe("module cache persistence", () => {
	it("round-trips the stat through getRunsByProject and getLatestRun", async () => {
		const { summary, report } = await run(
			Effect.gen(function* () {
				const store = yield* seed;
				const reader = yield* DataReader;
				yield* store.writeRun(runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z" }, COLD));
				const summaries = yield* reader.getRunsByProject();
				const latest = yield* reader.getLatestRun("app");
				return { summary: summaries.find((s) => s.project === "app"), report: Option.getOrThrow(latest) };
			}),
		);
		expect(summary?.moduleCache).toEqual(COLD);
		expect(report.moduleCache).toEqual(COLD);
	});

	it("keeps a stat with no written count (cache off) distinct from no stat at all", async () => {
		const { columns, summary, report } = await run(
			Effect.gen(function* () {
				const store = yield* seed;
				const reader = yield* DataReader;
				const sql = yield* SqlClient;
				yield* store.writeRun(runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z" }, OFF));
				yield* store.writeRun(runInput({ invocationId: "i2", timestamp: "2026-01-02T00:00:00.000Z", project: "lib" }));
				const columns = yield* sql<{ module_cache_enabled: number | null }>`
					SELECT module_cache_enabled FROM test_runs ORDER BY id`;
				const summaries = yield* reader.getRunsByProject();
				const latest = yield* reader.getLatestRun("lib");
				return { columns, summary: summaries.find((s) => s.project === "app"), report: Option.getOrThrow(latest) };
			}),
		);
		expect(columns).toEqual([{ module_cache_enabled: 0 }, { module_cache_enabled: null }]);
		expect(summary?.moduleCache).toEqual(OFF);
		expect(report).not.toHaveProperty("moduleCache");
	});

	it("lists a project's recorded stats newest first, skipping runs without one, up to the limit", async () => {
		const history = await run(
			Effect.gen(function* () {
				const store = yield* seed;
				const reader = yield* DataReader;
				yield* store.writeRun(runInput({ invocationId: "i1", timestamp: "2026-01-01T00:00:00.000Z" }, COLD));
				yield* store.writeRun(runInput({ invocationId: "i2", timestamp: "2026-01-02T00:00:00.000Z" }, WARM));
				yield* store.writeRun(runInput({ invocationId: "i3", timestamp: "2026-01-03T00:00:00.000Z" }));
				yield* store.writeRun(
					runInput({ invocationId: "i4", timestamp: "2026-01-04T00:00:00.000Z", project: "lib" }, OFF),
				);
				return {
					all: yield* reader.getModuleCacheHistory({ project: "app" }),
					limited: yield* reader.getModuleCacheHistory({ project: "app", limit: 1 }),
				};
			}),
		);
		expect(history.all.runs).toEqual([
			{ project: "app", timestamp: "2026-01-02T00:00:00.000Z", moduleCache: WARM },
			{ project: "app", timestamp: "2026-01-01T00:00:00.000Z", moduleCache: COLD },
		]);
		expect(history.limited.runs).toHaveLength(1);
	});
});
