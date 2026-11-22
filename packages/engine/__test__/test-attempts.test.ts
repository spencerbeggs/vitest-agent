import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

const settingsInput = {
	vitestVersion: "5.1.0",
	pool: "forks",
	environment: "node",
	testTimeout: 5000,
	hookTimeout: 10000,
	slowTestThreshold: 300,
	maxConcurrency: 5,
	maxWorkers: 4,
	isolate: true,
	bail: 0,
	globals: false,
	fileParallelism: true,
	sequenceSeed: 42,
	coverageProvider: "v8",
};

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(":memory:")));

/** One failed-then-passed test (a flake) and one clean test, in one run. */
const seed = Effect.gen(function* () {
	const store = yield* DataStore;
	yield* store.writeSettings("h", settingsInput, {});
	const runId = yield* store.writeRun({
		invocationId: "inv",
		project: "proj",
		settingsHash: "h",
		timestamp: "2026-11-22T00:00:00.000Z",
		commitSha: null,
		branch: null,
		reason: "passed",
		duration: 10,
		total: 2,
		passed: 2,
		failed: 0,
		skipped: 0,
		scoped: false,
	});
	const fileId = yield* store.ensureFile("src/a.test.ts");
	const [moduleId] = yield* store.writeModules(runId, [{ fileId, relativeModuleId: "src/a.test.ts", state: "passed" }]);
	const [flakyId, cleanId] = yield* store.writeTestCases(moduleId, [
		{ name: "flaky", fullName: "flaky", state: "passed", retryCount: 1 },
		{ name: "clean", fullName: "clean", state: "passed" },
	]);
	return { store, runId, flakyId, cleanId };
});

describe("test attempts", () => {
	it("writeTestAttempts persists one row per attempt and returns their ids in order", async () => {
		const rows = await run(
			Effect.gen(function* () {
				const { store, flakyId } = yield* seed;
				const ids = yield* store.writeTestAttempts(flakyId, [
					{ retryIndex: 0, repeatIndex: 0, state: "failed", duration: 5, startTime: 100 },
					{ retryIndex: 1, repeatIndex: 0, state: "passed", duration: 3, startTime: 110 },
				]);
				const sql = yield* SqlClient;
				const stored = yield* sql<{
					id: number;
					retry_index: number;
					repeat_index: number;
					state: string;
				}>`SELECT id, retry_index, repeat_index, state FROM test_attempts WHERE test_case_id = ${flakyId} ORDER BY id`;
				return { ids, stored };
			}),
		);
		expect(rows.stored.map((r) => r.id)).toEqual(rows.ids);
		expect(rows.stored.map((r) => [r.retry_index, r.state])).toEqual([
			[0, "failed"],
			[1, "passed"],
		]);
	});

	it("getErrors reports which attempt an error belongs to, and null for unattributed errors", async () => {
		const errors = await run(
			Effect.gen(function* () {
				const { store, runId, flakyId } = yield* seed;
				const [failed] = yield* store.writeTestAttempts(flakyId, [
					{ retryIndex: 0, repeatIndex: 0, state: "failed" },
					{ retryIndex: 1, repeatIndex: 0, state: "passed" },
				]);
				yield* store.writeErrors(runId, [
					{ testCaseId: flakyId, scope: "test", message: "first try", attemptId: failed },
					{ scope: "unhandled", message: "stray" },
				]);
				const reader = yield* DataReader;
				return yield* reader.getErrors("proj");
			}),
		);
		expect(errors.map((e) => [e.message, e.attempt])).toEqual([
			["first try", { retryIndex: 0, repeatIndex: 0 }],
			["stray", null],
		]);
	});

	it("getRetriedTests lists only tests with more than one attempt, with each attempt's state and error ids", async () => {
		const retried = await run(
			Effect.gen(function* () {
				const { store, runId, flakyId, cleanId } = yield* seed;
				const [failed] = yield* store.writeTestAttempts(flakyId, [
					{ retryIndex: 0, repeatIndex: 0, state: "failed", duration: 5 },
					{ retryIndex: 1, repeatIndex: 0, state: "passed", duration: 3 },
				]);
				yield* store.writeTestAttempts(cleanId, [{ retryIndex: 0, repeatIndex: 0, state: "passed" }]);
				yield* store.writeErrors(runId, [
					{ testCaseId: flakyId, scope: "test", message: "first try", attemptId: failed },
				]);
				const reader = yield* DataReader;
				const scoped = yield* reader.getRetriedTests("proj", { testName: "clean" });
				const all = yield* reader.getRetriedTests("proj");
				return { scoped, all };
			}),
		);
		expect(retried.scoped).toEqual([]);
		expect(retried.all).toHaveLength(1);
		expect(retried.all[0]).toMatchObject({ modulePath: "src/a.test.ts", fullName: "flaky" });
		expect(retried.all[0].attempts.map((a) => [a.retryIndex, a.repeatIndex, a.state, a.errorIds.length])).toEqual([
			[0, 0, "failed", 1],
			[1, 0, "passed", 0],
		]);
		expect(retried.all[0].attempts[0].duration).toBe(5);
	});
});
