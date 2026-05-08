import * as NodeContext from "@effect/platform-node/NodeContext";
import type { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import { HistoryTrackerLive } from "../src/layers/HistoryTrackerLive.js";
import migration0001 from "../src/migrations/0001_initial.js";
import type { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { HistoryTracker } from "../src/services/HistoryTracker.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeContext.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(SqliteLayer)),
	HistoryTrackerLive.pipe(Layer.provide(DataReaderLive.pipe(Layer.provide(SqliteLayer)))),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);

const run = <A, E>(effect: Effect.Effect<A, E, HistoryTracker | DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

const PROJECT = "default";
const TS = "2026-03-21T00:00:00.000Z";

// Settings needed to create runs
const SETTINGS_HASH = "test-hash";
const SETTINGS_INPUT = {
	vitest_version: "3.2.0",
	pool: "forks",
	environment: "node",
};

/**
 * Helper: seed settings + a run, then seed history entries for a test.
 * Returns the runId for further use.
 */
function seedHistoryEntries(
	entries: ReadonlyArray<{ fullName: string; runs: ReadonlyArray<{ timestamp: string; state: "passed" | "failed" }> }>,
) {
	return Effect.gen(function* () {
		const store = yield* DataStore;

		// Seed settings
		yield* store.writeSettings(SETTINGS_HASH, SETTINGS_INPUT, {});

		// Seed a run for each history entry timestamp
		let runId = 0;
		for (const entry of entries) {
			for (const histRun of entry.runs) {
				runId = yield* store.writeRun({
					invocationId: `inv-${histRun.timestamp}`,
					project: PROJECT,
					settingsHash: SETTINGS_HASH,
					timestamp: histRun.timestamp,
					commitSha: null,
					branch: null,
					reason: histRun.state === "passed" ? "passed" : "failed",
					duration: 100,
					total: 1,
					passed: histRun.state === "passed" ? 1 : 0,
					failed: histRun.state === "failed" ? 1 : 0,
					skipped: 0,
					scoped: false,
				});

				yield* store.writeHistory(
					PROJECT,
					entry.fullName,
					runId,
					histRun.timestamp,
					histRun.state,
					100,
					false,
					0,
					histRun.state === "failed" ? "Test failed" : null,
				);
			}
		}

		return runId;
	});
}

describe("HistoryTrackerLive", () => {
	describe("stable -- all passing, no prior history", () => {
		it("classifies passing tests with no prior history as stable", async () => {
			const outcomes = [{ fullName: "Suite > test one", state: "passed" as const }];

			const result = await run(Effect.flatMap(HistoryTracker, (svc) => svc.classify(PROJECT, outcomes, TS)));

			expect(result.classifications.get("Suite > test one")).toBe("stable");
		});

		it("classifies passing tests with all prior runs passed as stable", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > test one",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "passed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "passed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > test one", state: "passed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > test one")).toBe("stable");
		});
	});

	describe("new-failure -- failing with no prior history", () => {
		it("classifies failing test with no prior runs as new-failure", async () => {
			const outcomes = [{ fullName: "Suite > broken test", state: "failed" as const }];

			const result = await run(Effect.flatMap(HistoryTracker, (svc) => svc.classify(PROJECT, outcomes, TS)));

			expect(result.classifications.get("Suite > broken test")).toBe("new-failure");
		});
	});

	describe("new-failure -- failing when all prior runs were passed", () => {
		it("classifies failing test as new-failure when all prior runs passed", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > now failing",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "passed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "passed" },
								{ timestamp: "2026-03-17T00:00:00.000Z", state: "passed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > now failing", state: "failed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > now failing")).toBe("new-failure");
		});
	});

	describe("persistent -- failing when prior run also failed", () => {
		it("classifies failing test as persistent when most recent prior run also failed", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > persistent failure",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "failed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "passed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > persistent failure", state: "failed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > persistent failure")).toBe("persistent");
		});

		it("classifies failing test as persistent when all prior runs also failed", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > always fails",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "failed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "failed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > always fails", state: "failed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > always fails")).toBe("persistent");
		});
	});

	describe("flaky -- failing with mixed prior history", () => {
		it("classifies failing test as flaky when prior history is mixed (pass then fail)", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > flaky test",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "passed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "failed" },
								{ timestamp: "2026-03-17T00:00:00.000Z", state: "passed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > flaky test", state: "failed" }], TS);
				}),
			);

			// priorRuns[0].state = "passed" (not failed), and there are prior failures => flaky
			expect(result.classifications.get("Suite > flaky test")).toBe("flaky");
		});
	});

	describe("recovered -- passing with prior failures", () => {
		it("classifies passing test as recovered when prior history has failures", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > recovered test",
							runs: [
								{ timestamp: "2026-03-19T00:00:00.000Z", state: "failed" },
								{ timestamp: "2026-03-18T00:00:00.000Z", state: "passed" },
							],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > recovered test", state: "passed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > recovered test")).toBe("recovered");
		});
	});

	describe("window pruning", () => {
		it("prunes history to max 10 entries", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > stable test",
							runs: Array.from({ length: 10 }, (_, i) => ({
								timestamp: `2026-03-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
								state: "passed" as const,
							})),
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > stable test", state: "passed" }], TS);
				}),
			);

			const testHistory = result.history.tests.find((t) => t.fullName === "Suite > stable test");
			expect(testHistory).toBeDefined();
			if (!testHistory) return;
			expect(testHistory.runs).toHaveLength(10);
			// The newest run should be the current one
			expect(testHistory.runs[0].timestamp).toBe(TS);
		});

		it("keeps at most 10 entries when starting from 9 prior runs", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > test",
							runs: Array.from({ length: 9 }, (_, i) => ({
								timestamp: `2026-03-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
								state: "passed" as const,
							})),
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > test", state: "passed" }], TS);
				}),
			);

			const testHistory = result.history.tests.find((t) => t.fullName === "Suite > test");
			expect(testHistory).toBeDefined();
			if (!testHistory) return;
			expect(testHistory.runs).toHaveLength(10);
		});
	});

	describe("new test not in existing history", () => {
		it("correctly classifies a brand new test not previously tracked", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > existing test",
							runs: [{ timestamp: "2026-03-19T00:00:00.000Z", state: "passed" }],
						},
					]);

					const tracker = yield* HistoryTracker;
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > brand new test", state: "passed" }], TS);
				}),
			);

			expect(result.classifications.get("Suite > brand new test")).toBe("stable");
			const newEntry = result.history.tests.find((t) => t.fullName === "Suite > brand new test");
			expect(newEntry).toBeDefined();
			if (!newEntry) return;
			expect(newEntry.runs).toHaveLength(1);
		});
	});

	describe("existing tests not in current run stay in history", () => {
		it("preserves tests from prior history even if not in current run", async () => {
			const result = await run(
				Effect.gen(function* () {
					yield* seedHistoryEntries([
						{
							fullName: "Suite > test A",
							runs: [{ timestamp: "2026-03-19T00:00:00.000Z", state: "passed" }],
						},
						{
							fullName: "Suite > test B",
							runs: [{ timestamp: "2026-03-19T00:00:00.000Z", state: "failed" }],
						},
					]);

					const tracker = yield* HistoryTracker;
					// Only test A in current run; test B should stay in history
					return yield* tracker.classify(PROJECT, [{ fullName: "Suite > test A", state: "passed" }], TS);
				}),
			);

			const testAHistory = result.history.tests.find((t) => t.fullName === "Suite > test A");
			const testBHistory = result.history.tests.find((t) => t.fullName === "Suite > test B");

			expect(testAHistory).toBeDefined();
			expect(testBHistory).toBeDefined();
			if (!testBHistory) return;
			// test B not in current run, so its runs are unchanged
			expect(testBHistory.runs).toHaveLength(1);
			expect(testBHistory.runs[0].state).toBe("failed");
		});
	});

	describe("history record output", () => {
		it("returns updated history with correct project and timestamp", async () => {
			const outcomes = [{ fullName: "test", state: "passed" as const }];

			const result = await run(Effect.flatMap(HistoryTracker, (svc) => svc.classify(PROJECT, outcomes, TS)));

			expect(result.history.project).toBe(PROJECT);
			expect(result.history.updatedAt).toBe(TS);
		});

		it("includes the current run in returned history", async () => {
			const outcomes = [{ fullName: "new test", state: "failed" as const }];

			const result = await run(Effect.flatMap(HistoryTracker, (svc) => svc.classify(PROJECT, outcomes, TS)));

			const entry = result.history.tests.find((t) => t.fullName === "new test");
			expect(entry).toBeDefined();
			if (!entry) return;
			expect(entry.runs[0]).toEqual({ timestamp: TS, state: "failed" });
		});
	});
});
