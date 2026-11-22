import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { PROJECT_MIGRATIONS } from "../src/migrations/index.js";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";

const settingsInput = {
	vitestVersion: "5.1.1",
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

/** One failed test and one passing test in one run. */
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
		reason: "failed",
		duration: 10,
		total: 2,
		passed: 1,
		failed: 1,
		skipped: 0,
		scoped: false,
	});
	const fileId = yield* store.ensureFile("src/a.test.ts");
	const [moduleId] = yield* store.writeModules(runId, [{ fileId, relativeModuleId: "src/a.test.ts", state: "failed" }]);
	const [failedId, passedId] = yield* store.writeTestCases(moduleId, [
		{ name: "fails", fullName: "fails", state: "failed" },
		{ name: "passes", fullName: "passes", state: "passed" },
	]);
	return { store, runId, moduleId, failedId, passedId };
});

const STEPS = [
	{ name: "expect.toBe", status: "fail" as const, startTime: 12.5, duration: 3, depth: 1, locator: "button" },
	{ name: "mark", startTime: 20, depth: 0, location: { file: "src/a.test.ts", line: 4, column: 7 } },
];

describe("0007_trace_steps", () => {
	it("is registered in PROJECT_MIGRATIONS after 0006", () => {
		expect(Object.keys(PROJECT_MIGRATIONS).slice(5, 7)).toEqual(["0006_test_attempts", "0007_trace_steps"]);
	});
});

describe("test trace steps", () => {
	it("writeTraceSteps persists ordered steps and getErrors serves them on the test's errors", async () => {
		const errors = await run(
			Effect.gen(function* () {
				const { store, runId, failedId } = yield* seed;
				const [attemptId] = yield* store.writeTestAttempts(failedId, [
					{ retryIndex: 0, repeatIndex: 0, state: "failed" },
				]);
				yield* store.writeTraceSteps(failedId, attemptId ?? null, STEPS);
				yield* store.writeErrors(runId, [{ testCaseId: failedId, scope: "test", message: "boom", attemptId }]);
				return yield* (yield* DataReader).getErrors("proj");
			}),
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.traceSteps).toEqual(STEPS);
	});

	it("getErrors serves an empty traceSteps list for errors without recorded steps", async () => {
		const errors = await run(
			Effect.gen(function* () {
				const { store, runId, failedId } = yield* seed;
				yield* store.writeErrors(runId, [
					{ testCaseId: failedId, scope: "test", message: "boom" },
					{ scope: "unhandled", message: "stray" },
				]);
				return yield* (yield* DataReader).getErrors("proj");
			}),
		);
		expect(errors.map((e) => e.traceSteps)).toEqual([[], []]);
	});

	it("steps are keyed to the test case and cascade away with it", async () => {
		const counts = await run(
			Effect.gen(function* () {
				const { store, failedId, passedId } = yield* seed;
				yield* store.writeTraceSteps(failedId, null, STEPS);
				yield* store.writeTraceSteps(passedId, null, [{ name: "other", startTime: 1, depth: 0 }]);
				const sql = yield* SqlClient;
				const before = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM test_trace_steps`;
				yield* sql`DELETE FROM test_cases WHERE id = ${failedId}`;
				const after = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM test_trace_steps`;
				return { before: before[0]?.n, after: after[0]?.n };
			}),
		);
		expect(counts).toEqual({ before: 3, after: 1 });
	});
});
