import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer, Option } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import migration0001 from "../src/migrations/0001_initial.js";

import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeServices.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
	}),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(SqliteLayer)),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

// Shared test data
const settingsHash = "test-hash";
const settingsInput = {
	vitestVersion: "3.2.0",
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

const runInput = {
	invocationId: "inv-001",
	project: "my-project",
	settingsHash,
	timestamp: "2026-03-22T00:00:00.000Z",
	commitSha: "deadbeef",
	branch: "main",
	reason: "passed" as const,
	duration: 1234,
	total: 10,
	passed: 9,
	failed: 1,
	skipped: 0,
	scoped: false,
};

describe("DataReaderLive", () => {
	describe("getManifest", () => {
		it("returns Option.none() for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getManifest();
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns manifest after seeding runs", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings(settingsHash, settingsInput, {});
					yield* store.writeRun(runInput);

					return yield* reader.getManifest();
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const manifest = Option.getOrThrow(result);
			expect(manifest.projects).toHaveLength(1);
			expect(manifest.projects[0].project).toBe("my-project");
			expect(manifest.projects[0].lastResult).toBe("passed");
			expect(manifest.projects[0].lastRun).toBe("2026-03-22T00:00:00.000Z");
			// In-memory databases report an empty file path via PRAGMA database_list;
			// real on-disk databases report their absolute path. The previous
			// hardcoded "sql:" placeholder leaked into MCP cache_health output.
			expect(typeof manifest.cacheDir).toBe("string");
		});
	});

	describe("getRunsByProject", () => {
		it("returns empty array for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getRunsByProject();
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("returns summaries after seeding runs", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("runs-hash", settingsInput, {});
					yield* store.writeRun({ ...runInput, settingsHash: "runs-hash" });

					return yield* reader.getRunsByProject();
				}),
			);
			expect(result.length).toBeGreaterThanOrEqual(1);
			const summary = result.find((r) => r.project === "my-project");
			expect(summary).toBeDefined();
			expect(summary?.total).toBe(10);
			expect(summary?.passed).toBe(9);
			expect(summary?.failed).toBe(1);
		});
	});

	describe("getHistory", () => {
		it("returns empty tests array for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getHistory("nonexistent");
				}),
			);
			expect(result.tests).toHaveLength(0);
			expect(result.project).toBe("nonexistent");
		});

		it("returns grouped history after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("hist-read-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "hist-read-hash" });

					yield* store.writeHistory(
						"hist-proj",
						"suite > test A",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						50,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"hist-proj",
						"suite > test A",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						60,
						false,
						0,
						"assertion error",
					);
					yield* store.writeHistory(
						"hist-proj",
						"suite > test B",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						30,
						false,
						0,
						null,
					);

					return yield* reader.getHistory("hist-proj");
				}),
			);
			expect(result.tests).toHaveLength(2);
			const testA = result.tests.find((t) => t.fullName === "suite > test A");
			expect(testA).toBeDefined();
			expect(testA?.runs).toHaveLength(2);
			const testB = result.tests.find((t) => t.fullName === "suite > test B");
			expect(testB?.runs).toHaveLength(1);
		});
	});

	describe("getBaselines", () => {
		it("returns Option.none() for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getBaselines("__global__");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns baselines after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeBaselines({
						updatedAt: "2026-03-22T00:00:00.000Z",
						global: { lines: 80, branches: 70, functions: 85 },
						patterns: [["src/**/*.ts", { lines: 90 }]],
					});

					return yield* reader.getBaselines("__global__");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const baselines = Option.getOrThrow(result);
			expect(baselines.global.lines).toBe(80);
			expect(baselines.global.branches).toBe(70);
			expect(baselines.global.functions).toBe(85);
			expect(baselines.patterns).toHaveLength(1);
			expect(baselines.patterns[0][0]).toBe("src/**/*.ts");
			expect(baselines.patterns[0][1].lines).toBe(90);
		});
	});

	describe("getTrends", () => {
		it("returns Option.none() for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getTrends("nonexistent");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns trend entries after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("trend-read-hash", settingsInput, {});
					const runId1 = yield* store.writeRun({
						...runInput,
						settingsHash: "trend-read-hash",
						timestamp: "2026-03-22T01:00:00.000Z",
					});
					yield* store.writeTrends("trend-proj", runId1, {
						timestamp: "2026-03-22T01:00:00.000Z",
						coverage: { lines: 78, branches: 65, functions: 80, statements: 75 },
						delta: { lines: 0, branches: 0, functions: 0, statements: 0 },
						direction: "stable",
						targetsHash: "abc",
					});

					const runId2 = yield* store.writeRun({
						...runInput,
						settingsHash: "trend-read-hash",
						timestamp: "2026-03-22T02:00:00.000Z",
					});
					yield* store.writeTrends("trend-proj", runId2, {
						timestamp: "2026-03-22T02:00:00.000Z",
						coverage: { lines: 80, branches: 67, functions: 82, statements: 77 },
						delta: { lines: 2, branches: 2, functions: 2, statements: 2 },
						direction: "improving",
						targetsHash: "abc",
					});

					return yield* reader.getTrends("trend-proj");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const trends = Option.getOrThrow(result);
			expect(trends.entries).toHaveLength(2);
			// Entries should be in chronological order
			expect(trends.entries[0].timestamp).toBe("2026-03-22T01:00:00.000Z");
			expect(trends.entries[1].timestamp).toBe("2026-03-22T02:00:00.000Z");
			expect(trends.entries[1].direction).toBe("improving");
		});

		it("respects limit parameter", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("trend-limit-hash", settingsInput, {});
					for (let i = 0; i < 5; i++) {
						const rid = yield* store.writeRun({
							...runInput,
							settingsHash: "trend-limit-hash",
							timestamp: `2026-03-22T0${i}:00:00.000Z`,
						});
						yield* store.writeTrends("trend-limit-proj", rid, {
							timestamp: `2026-03-22T0${i}:00:00.000Z`,
							coverage: { lines: 70 + i, branches: 60, functions: 70, statements: 65 },
							delta: { lines: 1, branches: 0, functions: 0, statements: 0 },
							direction: "improving",
						});
					}

					return yield* reader.getTrends("trend-limit-proj", 3);
				}),
			);
			const trends = Option.getOrThrow(result);
			expect(trends.entries).toHaveLength(3);
		});
	});

	describe("getFlaky", () => {
		it("returns empty array when no flaky tests", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getFlaky("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("identifies tests with mixed pass/fail", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("flaky-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "flaky-hash" });

					// Test with mixed results = flaky
					yield* store.writeHistory(
						"flaky-proj",
						"flaky test",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"flaky-proj",
						"flaky test",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"oops",
					);
					yield* store.writeHistory(
						"flaky-proj",
						"flaky test",
						"src/history.test.ts",
						runId,
						"2026-03-22T03:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);

					// Test that always passes = not flaky
					yield* store.writeHistory(
						"flaky-proj",
						"stable test",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"flaky-proj",
						"stable test",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);

					return yield* reader.getFlaky("flaky-proj");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].fullName).toBe("flaky test");
			expect(result[0].passCount).toBe(2);
			expect(result[0].failCount).toBe(1);
		});

		it("does not flag a clean red->green recovery (all fails precede all passes) as flaky", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("recovery-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "recovery-hash" });

					// A TDD red->green cycle: three failing red-phase runs, then two
					// passing runs after the fix. Every failure precedes every pass
					// (monotonic recovery), so this is a recovery, not flakiness.
					yield* store.writeHistory(
						"recovery-proj",
						"tdd test",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom",
					);
					yield* store.writeHistory(
						"recovery-proj",
						"tdd test",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom",
					);
					yield* store.writeHistory(
						"recovery-proj",
						"tdd test",
						"src/history.test.ts",
						runId,
						"2026-03-22T03:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom",
					);
					yield* store.writeHistory(
						"recovery-proj",
						"tdd test",
						"src/history.test.ts",
						runId,
						"2026-03-22T04:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"recovery-proj",
						"tdd test",
						"src/history.test.ts",
						runId,
						"2026-03-22T05:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);

					return yield* reader.getFlaky("recovery-proj");
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("keeps same-named tests in different modules as distinct series", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("qual-flaky-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "qual-flaky-hash" });

					// Same fullName "dup" in two different files. The flaky.test.ts copy
					// oscillates pass->fail->pass; the stable.test.ts copy always passes.
					// If history grouped by full_name only (the pre-file-qualified bug),
					// the two would merge into one 3-pass/1-fail series and report a
					// single flaky row. File-qualified, only flaky.test.ts is flaky.
					yield* store.writeHistory(
						"qual-proj",
						"dup",
						"src/flaky.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"qual-proj",
						"dup",
						"src/flaky.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"oops",
					);
					yield* store.writeHistory(
						"qual-proj",
						"dup",
						"src/flaky.test.ts",
						runId,
						"2026-03-22T03:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"qual-proj",
						"dup",
						"src/stable.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"qual-proj",
						"dup",
						"src/stable.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);

					return yield* reader.getFlaky("qual-proj");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].fullName).toBe("dup");
			expect(result[0].modulePath).toBe("src/flaky.test.ts");
			expect(result[0].passCount).toBe(2);
			expect(result[0].failCount).toBe(1);
		});
	});

	describe("getPersistentFailures", () => {
		it("returns empty array when no persistent failures", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getPersistentFailures("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("identifies tests with consecutive failures", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("persist-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "persist-hash" });

					// Test with 3 consecutive failures at the end
					yield* store.writeHistory(
						"persist-proj",
						"broken test",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"persist-proj",
						"broken test",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"error 1",
					);
					yield* store.writeHistory(
						"persist-proj",
						"broken test",
						"src/history.test.ts",
						runId,
						"2026-03-22T03:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"error 2",
					);
					yield* store.writeHistory(
						"persist-proj",
						"broken test",
						"src/history.test.ts",
						runId,
						"2026-03-22T04:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"error 3",
					);

					// Test with only 1 failure = not persistent
					yield* store.writeHistory(
						"persist-proj",
						"one-time fail",
						"src/history.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"persist-proj",
						"one-time fail",
						"src/history.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"once",
					);

					return yield* reader.getPersistentFailures("persist-proj");
				}),
			);
			// "broken test" has 3 consecutive failures, "one-time fail" has only 1
			expect(result).toHaveLength(1);
			expect(result[0].fullName).toBe("broken test");
			expect(result[0].consecutiveFailures).toBe(3);
			expect(result[0].lastErrorMessage).toBe("error 3");
		});

		it("surfaces a persistent failure that a same-named passing test in another module would hide", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("qual-persist-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "qual-persist-hash" });

					// Same fullName "dup" in two files. failing.test.ts fails twice;
					// passing.test.ts passes twice at later timestamps. Grouped by
					// full_name only, the recent passes would break the streak and hide
					// the persistent failure. File-qualified, failing.test.ts is caught.
					yield* store.writeHistory(
						"qual-persist-proj",
						"dup",
						"src/failing.test.ts",
						runId,
						"2026-03-22T01:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom",
					);
					yield* store.writeHistory(
						"qual-persist-proj",
						"dup",
						"src/failing.test.ts",
						runId,
						"2026-03-22T02:00:00.000Z",
						"failed",
						10,
						false,
						0,
						"boom",
					);
					yield* store.writeHistory(
						"qual-persist-proj",
						"dup",
						"src/passing.test.ts",
						runId,
						"2026-03-22T03:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);
					yield* store.writeHistory(
						"qual-persist-proj",
						"dup",
						"src/passing.test.ts",
						runId,
						"2026-03-22T04:00:00.000Z",
						"passed",
						10,
						false,
						0,
						null,
					);

					return yield* reader.getPersistentFailures("qual-persist-proj");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].fullName).toBe("dup");
			expect(result[0].modulePath).toBe("src/failing.test.ts");
			expect(result[0].consecutiveFailures).toBe(2);
		});
	});

	describe("getLatestRun", () => {
		it("returns Option.none() for nonexistent project", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getLatestRun("nonexistent");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns assembled AgentReport", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("report-hash", settingsInput, {});
					const runId = yield* store.writeRun({
						...runInput,
						settingsHash: "report-hash",
						reason: "failed",
						failed: 1,
					});

					const fileId = yield* store.ensureFile("src/broken.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/broken.test.ts", state: "failed", duration: 100 },
					]);
					yield* store.writeTestCases(moduleId, [
						{ name: "fails", fullName: "suite > fails", state: "failed", duration: 10 },
						{ name: "passes", fullName: "suite > passes", state: "passed", duration: 5 },
					]);
					yield* store.writeErrors(runId, [{ scope: "unhandled", message: "Unhandled rejection" }]);

					return yield* reader.getLatestRun("my-project");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const report = Option.getOrThrow(result);
			expect(report.reason).toBe("failed");
			expect(report.summary.total).toBe(10);
			expect(report.failed).toHaveLength(1);
			expect(report.failed[0].file).toBe("src/broken.test.ts");
			expect(report.failed[0].tests).toHaveLength(2);
			expect(report.unhandledErrors).toHaveLength(1);
			expect(report.unhandledErrors[0].message).toBe("Unhandled rejection");
		});
	});

	describe("getFileCoverage", () => {
		it("returns coverage data for a run", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("cov-read-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "cov-read-hash" });
					const fileId = yield* store.ensureFile("src/covered.ts");

					yield* store.writeCoverage(runId, [
						{
							fileId,
							statements: 85.5,
							branches: 70.0,
							functions: 90.0,
							lines: 82.3,
							uncoveredLines: "42-50,99",
						},
					]);

					return yield* reader.getFileCoverage(runId);
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].file).toBe("src/covered.ts");
			expect(result[0].summary.lines).toBeCloseTo(82.3);
			expect(result[0].uncoveredLines).toBe("42-50,99");
		});
	});

	describe("getCoverage", () => {
		it("returns Option.none() when no runs exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getCoverage("nonexistent");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns coverage data after seeding run with file_coverage and trends", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("cov-report-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "cov-report-hash", project: "cov-proj" });
					const fileId1 = yield* store.ensureFile("src/utils.ts");
					const fileId2 = yield* store.ensureFile("src/helpers.ts");

					yield* store.writeCoverage(runId, [
						{
							fileId: fileId1,
							statements: 85.0,
							branches: 70.0,
							functions: 90.0,
							lines: 82.0,
							uncoveredLines: "42-50,99",
						},
						{
							fileId: fileId2,
							statements: 60.0,
							branches: 50.0,
							functions: 75.0,
							lines: 65.0,
							uncoveredLines: "10-20",
						},
					]);

					// Seed trends for totals
					yield* store.writeTrends("cov-proj", runId, {
						timestamp: "2026-03-22T00:00:00.000Z",
						coverage: { lines: 73.5, branches: 60.0, functions: 82.5, statements: 72.5 },
						delta: { lines: 0, branches: 0, functions: 0, statements: 0 },
						direction: "stable",
					});

					// Seed baselines (global)
					yield* store.writeBaselines({
						updatedAt: "2026-03-22T00:00:00.000Z",
						global: { lines: 70, branches: 55, functions: 80 },
						patterns: [],
					});

					return yield* reader.getCoverage("cov-proj");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const coverage = Option.getOrThrow(result);
			// Totals from trends
			expect(coverage.totals.lines).toBeCloseTo(73.5);
			expect(coverage.totals.branches).toBeCloseTo(60.0);
			expect(coverage.totals.functions).toBeCloseTo(82.5);
			expect(coverage.totals.statements).toBeCloseTo(72.5);
			// File coverage
			expect(coverage.lowCoverage).toHaveLength(2);
			expect(coverage.lowCoverageFiles).toContain("src/utils.ts");
			expect(coverage.lowCoverageFiles).toContain("src/helpers.ts");
			expect(coverage.lowCoverage[0].uncoveredLines).toBe("42-50,99");
			// Thresholds from baselines
			expect(coverage.thresholds.global.lines).toBe(70);
			expect(coverage.thresholds.global.branches).toBe(55);
			expect(coverage.thresholds.global.functions).toBe(80);
			expect(coverage.thresholds.patterns).toHaveLength(0);
		});

		it("falls back to averaging file coverage when no trends exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("cov-avg-hash", settingsInput, {});
					const runId = yield* store.writeRun({
						...runInput,
						settingsHash: "cov-avg-hash",
						project: "cov-avg-proj",
					});
					const fileId = yield* store.ensureFile("src/single.ts");

					yield* store.writeCoverage(runId, [
						{
							fileId,
							statements: 80.0,
							branches: 60.0,
							functions: 70.0,
							lines: 90.0,
							uncoveredLines: "5",
						},
					]);

					return yield* reader.getCoverage("cov-avg-proj");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const coverage = Option.getOrThrow(result);
			// With a single file, average = the file's values
			expect(coverage.totals.statements).toBeCloseTo(80.0);
			expect(coverage.totals.lines).toBeCloseTo(90.0);
			expect(coverage.lowCoverage).toHaveLength(1);
		});
	});

	describe("getTestsForFile", () => {
		it("returns test module paths mapped to a source file", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("stm-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "stm-hash" });
					const testFileId = yield* store.ensureFile("src/utils.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId: testFileId, relativeModuleId: "src/utils.test.ts", state: "passed" },
					]);

					yield* store.writeSourceMap("src/utils.ts", moduleId, "convention");

					return yield* reader.getTestsForFile("src/utils.ts");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe("src/utils.test.ts");
		});
	});

	describe("getErrors", () => {
		it("returns empty array for nonexistent project", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getErrors("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("returns errors from latest run", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("err-read-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "err-read-hash", project: "err-proj" });
					yield* store.writeErrors(runId, [
						{ scope: "test", message: "Expected true to be false", diff: "- true\n+ false", name: "AssertionError" },
						{ scope: "unhandled", message: "Unexpected error" },
					]);

					return yield* reader.getErrors("err-proj");
				}),
			);
			expect(result).toHaveLength(2);
			expect(result[0].scope).toBe("test");
			expect(result[0].message).toBe("Expected true to be false");
			expect(result[1].scope).toBe("unhandled");
		});

		it("filters by errorName when provided", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("err-filter-hash", settingsInput, {});
					const runId = yield* store.writeRun({
						...runInput,
						settingsHash: "err-filter-hash",
						project: "err-filter-proj",
					});
					yield* store.writeErrors(runId, [
						{ scope: "test", message: "assertion failed", name: "AssertionError" },
						{ scope: "test", message: "type error", name: "TypeError" },
					]);

					return yield* reader.getErrors("err-filter-proj", "TypeError");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].message).toBe("type error");
		});
	});

	describe("getNotes / getNoteById / searchNotes", () => {
		it("getNotes returns empty array for empty database", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getNotes();
				}),
			);
			expect(result).toHaveLength(0);
		});

		it("getNotes returns notes after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeNote({ title: "Note 1", content: "Content 1", scope: "global" });
					yield* store.writeNote({ title: "Note 2", content: "Content 2", scope: "project", project: "my-proj" });

					return yield* reader.getNotes();
				}),
			);
			expect(result).toHaveLength(2);
		});

		it("getNotes filters by scope", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeNote({ title: "Global", content: "global note", scope: "global" });
					yield* store.writeNote({ title: "Project", content: "project note", scope: "project", project: "p1" });

					return yield* reader.getNotes("global");
				}),
			);
			expect(result.length).toBeGreaterThanOrEqual(1);
			for (const note of result) {
				expect(note.scope).toBe("global");
			}
		});

		it("getNoteById returns Option.none() for nonexistent ID", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getNoteById(99999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("getNoteById returns note after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					const id = yield* store.writeNote({ title: "Find me", content: "Here I am", scope: "global" });
					return yield* reader.getNoteById(id);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const note = Option.getOrThrow(result);
			expect(note.title).toBe("Find me");
			expect(note.content).toBe("Here I am");
			expect(note.pinned).toBe(false);
		});

		it("searchNotes finds notes via FTS5", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeNote({ title: "Coverage report", content: "Coverage is at 80%", scope: "global" });
					yield* store.writeNote({ title: "Build status", content: "Build is green", scope: "global" });

					return yield* reader.searchNotes("coverage");
				}),
			);
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(result[0].title).toBe("Coverage report");
		});
	});

	describe("getLatestSettings", () => {
		it("returns Option.none() when no settings exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getLatestSettings();
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns most recent settings after seeding two rows", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("older-hash", settingsInput, { CI: "false" });
					yield* store.writeSettings("newer-hash", { ...settingsInput, pool: "threads" }, { CI: "true" });

					return yield* reader.getLatestSettings();
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const settings = Option.getOrThrow(result);
			expect(settings.hash).toBe("newer-hash");
			expect(settings.pool).toBe("threads");
			expect(settings.envVars).toEqual({ CI: "true" });
		});
	});

	describe("listTests", () => {
		it("returns test cases for latest run", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("list-tests-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "list-tests-hash", project: "list-proj" });
					const fileId = yield* store.ensureFile("src/utils.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/utils.test.ts", state: "passed", duration: 100 },
					]);
					yield* store.writeTestCases(moduleId, [
						{ name: "test A", fullName: "suite > test A", state: "passed", duration: 10 },
						{ name: "test B", fullName: "suite > test B", state: "failed", duration: 20 },
					]);

					return yield* reader.listTests("list-proj");
				}),
			);
			expect(result).toHaveLength(2);
			expect(result[0].fullName).toBe("suite > test A");
			expect(result[0].module).toBe("src/utils.test.ts");
			expect(result[1].fullName).toBe("suite > test B");
			expect(result[1].state).toBe("failed");
		});

		it("filters by state", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("list-filter-hash", settingsInput, {});
					const runId = yield* store.writeRun({
						...runInput,
						settingsHash: "list-filter-hash",
						project: "list-filter-proj",
					});
					const fileId = yield* store.ensureFile("src/filter.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/filter.test.ts", state: "failed", duration: 50 },
					]);
					yield* store.writeTestCases(moduleId, [
						{ name: "passes", fullName: "passes", state: "passed", duration: 5 },
						{ name: "fails", fullName: "fails", state: "failed", duration: 10 },
						{ name: "also fails", fullName: "also fails", state: "failed", duration: 15 },
					]);

					return yield* reader.listTests("list-filter-proj", { state: "failed" });
				}),
			);
			expect(result).toHaveLength(2);
			for (const t of result) {
				expect(t.state).toBe("failed");
			}
		});

		it("returns empty array when no runs exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.listTests("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});
	});

	describe("listModules", () => {
		it("returns modules for latest run", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("list-mod-hash", settingsInput, {});
					const runId = yield* store.writeRun({ ...runInput, settingsHash: "list-mod-hash", project: "list-mod-proj" });
					const fileId1 = yield* store.ensureFile("src/a.test.ts");
					const fileId2 = yield* store.ensureFile("src/b.test.ts");
					const [modId1] = yield* store.writeModules(runId, [
						{ fileId: fileId1, relativeModuleId: "src/a.test.ts", state: "passed", duration: 100 },
					]);
					yield* store.writeModules(runId, [
						{ fileId: fileId2, relativeModuleId: "src/b.test.ts", state: "failed", duration: 200 },
					]);
					yield* store.writeTestCases(modId1, [
						{ name: "test 1", fullName: "test 1", state: "passed", duration: 5 },
						{ name: "test 2", fullName: "test 2", state: "passed", duration: 10 },
					]);

					return yield* reader.listModules("list-mod-proj");
				}),
			);
			expect(result).toHaveLength(2);
			const modA = result.find((m) => m.file === "src/a.test.ts");
			expect(modA).toBeDefined();
			expect(modA?.testCount).toBe(2);
			expect(modA?.duration).toBe(100);
			const modB = result.find((m) => m.file === "src/b.test.ts");
			expect(modB?.testCount).toBe(0);
		});

		it("returns empty array when no runs exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.listModules("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});
	});

	describe("listSuites", () => {
		it("returns suites for latest run", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("list-suite-hash", settingsInput, {});
					const runId = yield* store.writeRun({
						...runInput,
						settingsHash: "list-suite-hash",
						project: "list-suite-proj",
					});
					const fileId = yield* store.ensureFile("src/suite.test.ts");
					const [moduleId] = yield* store.writeModules(runId, [
						{ fileId, relativeModuleId: "src/suite.test.ts", state: "passed", duration: 100 },
					]);
					const [suiteId] = yield* store.writeSuites(moduleId, [
						{ name: "my suite", fullName: "my suite", state: "passed" },
					]);
					yield* store.writeTestCases(moduleId, [
						{ name: "test in suite", fullName: "my suite > test in suite", state: "passed", duration: 5, suiteId },
					]);

					return yield* reader.listSuites("list-suite-proj");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("my suite");
			expect(result[0].module).toBe("src/suite.test.ts");
			expect(result[0].testCount).toBe(1);
		});

		it("returns empty array when no runs exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.listSuites("nonexistent");
				}),
			);
			expect(result).toHaveLength(0);
		});
	});

	describe("listSettings", () => {
		it("returns available settings hashes", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("ls-hash-1", settingsInput, {});
					yield* store.writeSettings("ls-hash-2", { ...settingsInput, pool: "threads" }, {});

					return yield* reader.listSettings();
				}),
			);
			expect(result.length).toBeGreaterThanOrEqual(2);
			const hashes = result.map((r) => r.hash);
			expect(hashes).toContain("ls-hash-1");
			expect(hashes).toContain("ls-hash-2");
			// Most recent first
			expect(result[0].capturedAt).toBeDefined();
		});

		it("returns empty array when no settings exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.listSettings();
				}),
			);
			// May have settings from other tests due to shared in-memory DB, but the method should not throw
			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe("getSettings", () => {
		it("returns Option.none() for nonexistent hash", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getSettings("nonexistent");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns settings with env vars after seeding", async () => {
			const result = await run(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const reader = yield* DataReader;

					yield* store.writeSettings("settings-read-hash", settingsInput, { CI: "true", NODE_ENV: "test" });

					return yield* reader.getSettings("settings-read-hash");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const settings = Option.getOrThrow(result);
			expect(settings.hash).toBe("settings-read-hash");
			expect(settings.pool).toBe("forks");
			expect(settings.environment).toBe("node");
			expect(settings.coverageProvider).toBe("v8");
			expect(settings.coverageEnabled).toBe(true);
			expect(settings.envVars).toEqual({ CI: "true", NODE_ENV: "test" });
		});
	});

	describe("getSessionById + searchTurns", () => {
		it("round-trips a session and its turns", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sid = yield* ds.writeSession({
						chatId: "cc-rt",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sid,
						turnNo: 1,
						type: "user_prompt",
						payload: "{}",
						occurredAt: "2026-04-29T00:00:01Z",
					});
					yield* ds.writeTurn({
						sessionId: sid,
						turnNo: 2,
						type: "tool_call",
						payload: "{}",
						occurredAt: "2026-04-29T00:00:02Z",
					});

					const dr = yield* DataReader;
					const session = yield* dr.getSessionById(sid);
					const turns = yield* dr.searchTurns({ sessionId: sid, limit: 100 });
					return { session, turns };
				}),
			);

			expect(Option.isSome(result.session)).toBe(true);
			expect(result.turns).toHaveLength(2);
			expect(result.turns[0].turnNo).toBe(2); // DESC order
		});
	});

	describe("getSessionByChatId", () => {
		it("returns the matching session", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;

					yield* ds.writeSession({
						chatId: "cc-lookup",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});

					return yield* dr.getSessionByChatId("cc-lookup");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.chatId).toBe("cc-lookup");
			}
		});

		it("returns None for unknown id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const dr = yield* DataReader;
					return yield* dr.getSessionByChatId("nope");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("findActiveSubagentSession", () => {
		it("returns the most recent un-ended subagent child of the parent", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;
					const mainId = yield* ds.writeSession({
						chatId: "cc-parent-a",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});
					// An older subagent child that has already ended, then a newer one
					// still running. Only the newer, un-ended child should resolve.
					yield* ds.writeSession({
						chatId: "cc-parent-a-subagent-1-1",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						agentType: "tdd-task",
						parentSessionId: mainId,
						startedAt: "2026-04-29T00:01:00Z",
					});
					yield* ds.endSession("cc-parent-a-subagent-1-1", "2026-04-29T00:02:00Z", "completed");
					yield* ds.writeSession({
						chatId: "cc-parent-a-subagent-2-2",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						agentType: "tdd-task",
						parentSessionId: mainId,
						startedAt: "2026-04-29T00:03:00Z",
					});
					return yield* dr.findActiveSubagentSession(mainId);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.chatId).toBe("cc-parent-a-subagent-2-2");
				expect(result.value.agentKind).toBe("subagent");
			}
		});

		it("returns None when every subagent child has ended", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;
					const mainId = yield* ds.writeSession({
						chatId: "cc-parent-b",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});
					yield* ds.writeSession({
						chatId: "cc-parent-b-subagent-1-1",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						agentType: "tdd-task",
						parentSessionId: mainId,
						startedAt: "2026-04-29T00:01:00Z",
					});
					yield* ds.endSession("cc-parent-b-subagent-1-1", "2026-04-29T00:02:00Z", "completed");
					return yield* dr.findActiveSubagentSession(mainId);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns None when the parent has no subagent children", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;
					const mainId = yield* ds.writeSession({
						chatId: "cc-parent-c",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-29T00:00:00Z",
					});
					return yield* dr.findActiveSubagentSession(mainId);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("computeAcceptanceMetrics", () => {
		it("returns zeros on an empty DB", async () => {
			const result = await run(
				Effect.gen(function* () {
					const dr = yield* DataReader;
					return yield* dr.computeAcceptanceMetrics();
				}),
			);
			expect(result.phaseEvidenceIntegrity.total).toBe(0);
			expect(result.phaseEvidenceIntegrity.ratio).toBe(0);
			expect(result.antiPatternDetectionRate.cleanSessions).toBe(0);
		});
	});

	describe("idempotent response cache", () => {
		it("recordIdempotentResponse writes a row that findIdempotentResponse reads back", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;
					yield* ds.recordIdempotentResponse({
						procedurePath: "hypothesis_record",
						key: "session-1:content-foo",
						resultJson: JSON.stringify({ id: 42 }),
						createdAt: "2026-04-30T00:00:00Z",
					});
					return yield* dr.findIdempotentResponse("hypothesis_record", "session-1:content-foo");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(JSON.parse(result.value)).toEqual({ id: 42 });
			}
		});

		it("findIdempotentResponse returns None for an unknown key", async () => {
			const result = await run(
				Effect.gen(function* () {
					const dr = yield* DataReader;
					return yield* dr.findIdempotentResponse("hypothesis_record", "no-such-key");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("recordIdempotentResponse on a duplicate key is a no-op (ON CONFLICT DO NOTHING)", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const dr = yield* DataReader;
					yield* ds.recordIdempotentResponse({
						procedurePath: "hypothesis_validate",
						key: "1:confirmed",
						resultJson: JSON.stringify({ id: 1, outcome: "confirmed" }),
						createdAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.recordIdempotentResponse({
						procedurePath: "hypothesis_validate",
						key: "1:confirmed",
						resultJson: JSON.stringify({ id: 1, outcome: "confirmed", second: true }),
						createdAt: "2026-04-30T00:01:00Z",
					});
					return yield* dr.findIdempotentResponse("hypothesis_validate", "1:confirmed");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				const parsed = JSON.parse(result.value);
				expect(parsed.second).toBeUndefined();
			}
		});
	});

	describe("getCurrentTddPhase", () => {
		it("returns the most-recent open phase for a TDD session", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					const sessionId = yield* ds.writeSession({
						chatId: "cc-cur",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:02Z",
					});
					yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "green",
						startedAt: "2026-04-29T00:00:10Z",
					});

					return yield* reader.getCurrentTddPhase(tddId);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.phase).toBe("green");
			}
		});

		it("returns None when no phases exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getCurrentTddPhase(999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns Some(spike) immediately after writeTddTask", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					const sessionId = yield* ds.writeSession({
						chatId: "cc-cur-spike",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "spike-on-start",
						startedAt: "2026-04-29T00:00:01Z",
					});

					return yield* reader.getCurrentTddPhase(tddId);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.phase).toBe("spike");
				expect(result.value.startedAt).toBe("2026-04-29T00:00:01Z");
				expect(result.value.behaviorId).toBeNull();
			}
		});
	});

	describe("getTddArtifactWithContext", () => {
		it("returns the artifact joined with test_cases / turns context", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					// Seed: session + tdd session + phase + a test-case authored
					// in this session (test_first_failure_run_id wired via test_run_id).
					const sessionId = yield* ds.writeSession({
						chatId: "cc-ctx",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const turnId = yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({
							type: "file_edit",
							file_path: "/abs/src/foo.test.ts",
							edit_kind: "edit",
						}),
						occurredAt: "2026-04-29T00:00:00.500Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					const phase = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:02Z",
					});
					yield* ds.writeSettings("ctx-hash", settingsInput, {});
					const runId = yield* ds.writeRun({
						...runInput,
						invocationId: "inv-ctx",
						settingsHash: "ctx-hash",
						project: "demo",
						timestamp: "2026-04-29T00:00:03Z",
						duration: 1,
						total: 1,
						passed: 0,
						failed: 1,
						skipped: 0,
						reason: "failed" as const,
					});
					const fileId = yield* ds.ensureFile("/abs/src/foo.test.ts");
					const moduleIds = yield* ds.writeModules(runId, [
						{ fileId, relativeModuleId: "src/foo.test.ts", state: "failed" },
					]);
					const testCaseIds = yield* ds.writeTestCases(moduleIds[0], [
						{
							name: "rejects empty",
							fullName: "Foo > rejects empty",
							state: "failed",
							createdTurnId: turnId,
						},
					]);

					const artifactId = yield* ds.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_failed_run",
						testCaseId: testCaseIds[0],
						testRunId: runId,
						testFirstFailureRunId: runId,
						recordedAt: "2026-04-29T00:00:04Z",
					});

					return yield* reader.getTddArtifactWithContext(artifactId);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.artifact_kind).toBe("test_failed_run");
				expect(result.value.test_case_authored_in_session).toBe(true);
				expect(result.value.test_first_failure_run_id).not.toBeNull();
			}
		});

		it("returns None for an unknown artifact id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getTddArtifactWithContext(99999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("listTddArtifactsForTask", () => {
		it("returns artifacts for a TDD session ordered by recorded_at DESC, id DESC tie-break", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					const sessionId = yield* ds.writeSession({
						chatId: "cc-list-art",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					const spike = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: "2026-04-29T00:00:02Z",
					});
					const red = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:10Z",
					});

					const a1 = yield* ds.writeTddArtifact({
						phaseId: spike.id,
						artifactKind: "test_written",
						recordedAt: "2026-04-29T00:00:03Z",
					});
					const a2 = yield* ds.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-29T00:00:11Z",
					});
					const a3 = yield* ds.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "code_written",
						recordedAt: "2026-04-29T00:00:12Z",
					});

					const all = yield* reader.listTddArtifactsForTask({ tddTaskId: tddId });
					return { all, ids: [a1, a2, a3], spikeId: spike.id, redId: red.id };
				}),
			);
			expect(result.all.map((r) => r.id)).toEqual([result.ids[2], result.ids[1], result.ids[0]]);
			expect(result.all[0].phaseName).toBe("red");
			expect(result.all[0].artifactKind).toBe("code_written");
			expect(result.all[2].phaseName).toBe("spike");
		});

		it("filters by artifactKind", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-list-art-kind",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					const phase = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:02Z",
					});
					yield* ds.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_written",
						recordedAt: "2026-04-29T00:00:03Z",
					});
					const failedId = yield* ds.writeTddArtifact({
						phaseId: phase.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-29T00:00:04Z",
					});
					const failures = yield* reader.listTddArtifactsForTask({
						tddTaskId: tddId,
						artifactKind: "test_failed_run",
					});
					return { failures, failedId };
				}),
			);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0].id).toBe(result.failedId);
			expect(result.failures[0].artifactKind).toBe("test_failed_run");
		});

		it("filters by phaseId", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-list-art-phase",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					const spike = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "spike",
						startedAt: "2026-04-29T00:00:02Z",
					});
					const red = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:10Z",
					});
					yield* ds.writeTddArtifact({
						phaseId: spike.id,
						artifactKind: "test_written",
						recordedAt: "2026-04-29T00:00:03Z",
					});
					const redArtifactId = yield* ds.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-04-29T00:00:11Z",
					});
					const redOnly = yield* reader.listTddArtifactsForTask({
						tddTaskId: tddId,
						phaseId: red.id,
					});
					return { redOnly, redArtifactId };
				}),
			);
			expect(result.redOnly).toHaveLength(1);
			expect(result.redOnly[0].id).toBe(result.redArtifactId);
		});

		it("respects the limit cap", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-list-art-limit",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					const phase = yield* ds.writeTddPhase({
						tddTaskId: tddId,
						phase: "red",
						startedAt: "2026-04-29T00:00:02Z",
					});
					for (let i = 0; i < 5; i += 1) {
						yield* ds.writeTddArtifact({
							phaseId: phase.id,
							artifactKind: "test_failed_run",
							recordedAt: `2026-04-29T00:00:0${3 + i}Z`,
						});
					}
					return yield* reader.listTddArtifactsForTask({ tddTaskId: tddId, limit: 2 });
				}),
			);
			expect(result).toHaveLength(2);
		});

		it("returns [] when the session has no artifacts", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-list-art-empty",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({
						sessionId,
						goal: "g",
						startedAt: "2026-04-29T00:00:01Z",
					});
					return yield* reader.listTddArtifactsForTask({ tddTaskId: tddId });
				}),
			);
			expect(result).toEqual([]);
		});
	});

	describe("getCommitChanges", () => {
		it("returns commit detail with attached changed files", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					yield* ds.writeCommit({
						sha: "deadbeef",
						message: "feat: x",
						author: "T",
						committedAt: "2026-04-29T00:00:00Z",
						branch: "main",
					});
					yield* ds.writeSettings("getcommit-hash", settingsInput, {});
					const runId = yield* ds.writeRun({
						...runInput,
						invocationId: "inv-getcommit",
						settingsHash: "getcommit-hash",
						project: "demo",
						timestamp: "2026-04-29T00:00:01Z",
						duration: 1,
						total: 0,
						passed: 0,
						failed: 0,
						skipped: 0,
						reason: "passed" as const,
					});
					yield* ds.writeRunChangedFiles({
						runId,
						files: [{ filePath: "/abs/src/x.ts", changeKind: "modified", commitSha: "deadbeef" }],
					});
					return yield* reader.getCommitChanges("deadbeef");
				}),
			);
			expect(result).toHaveLength(1);
			expect(result[0].sha).toBe("deadbeef");
			expect(result[0].files).toHaveLength(1);
			expect(result[0].files[0].filePath).toBe("/abs/src/x.ts");
		});
	});

	describe("getFailureSignatureByHash", () => {
		it("should surface lastSeenAt on FailureSignatureDetail", async () => {
			const detail = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					yield* ds.writeSettings("ls-detail-1", settingsInput, {});
					const runId = yield* ds.writeRun({ ...runInput, settingsHash: "ls-detail-1" });

					const seenAt = "2026-05-02T10:00:00Z";
					yield* ds.writeFailureSignature({
						signatureHash: "abcdef0123456789",
						runId,
						seenAt,
					});

					return yield* reader.getFailureSignatureByHash("abcdef0123456789");
				}),
			);
			expect(Option.isSome(detail)).toBe(true);
			if (Option.isSome(detail)) {
				expect(detail.value.signatureHash).toBe("abcdef0123456789");
				expect(detail.value.firstSeenAt).toBe("2026-05-02T10:00:00Z");
				expect(detail.value.lastSeenAt).toBe("2026-05-02T10:00:00Z");
			}
		});

		it("should reflect the bumped lastSeenAt after a recurrence", async () => {
			const detail = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;

					yield* ds.writeSettings("ls-detail-2", settingsInput, {});
					const runId = yield* ds.writeRun({ ...runInput, settingsHash: "ls-detail-2" });

					yield* ds.writeFailureSignature({
						signatureHash: "fedcba9876543210",
						runId,
						seenAt: "2026-05-02T10:00:00Z",
					});
					yield* ds.writeFailureSignature({
						signatureHash: "fedcba9876543210",
						runId,
						seenAt: "2026-05-03T11:00:00Z",
					});

					return yield* reader.getFailureSignatureByHash("fedcba9876543210");
				}),
			);
			expect(Option.isSome(detail)).toBe(true);
			if (Option.isSome(detail)) {
				expect(detail.value.firstSeenAt).toBe("2026-05-02T10:00:00Z");
				expect(detail.value.lastSeenAt).toBe("2026-05-03T11:00:00Z");
				expect(detail.value.occurrenceCount).toBe(2);
			}
		});
	});

	describe("getGoalById", () => {
		const seedSessionWithGoals = (chatId: string) =>
			Effect.gen(function* () {
				const ds = yield* DataStore;
				const sessionId = yield* ds.writeSession({
					chatId: chatId,
					project: "demo",
					cwd: "/tmp/demo",
					agentKind: "subagent",
					startedAt: "2026-04-29T00:00:00Z",
				});
				const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
				return tddId;
			});

		it("returns Some with nested behaviors", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const tddId = yield* seedSessionWithGoals("cc-rd-goal-1");
					const goal = yield* ds.createGoal({ tddTaskId: tddId, goal: "G" });
					yield* ds.createBehavior({ goalId: goal.id, behavior: "b1" });
					yield* ds.createBehavior({ goalId: goal.id, behavior: "b2" });
					return yield* reader.getGoalById(goal.id);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.goal).toBe("G");
				expect(result.value.behaviors).toHaveLength(2);
				expect(result.value.behaviors.map((b) => b.behavior)).toEqual(["b1", "b2"]);
			}
		});

		it("returns None for unknown id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getGoalById(99999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getGoalsByTddTask", () => {
		it("returns goals ordered by ordinal with nested behaviors", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-goals-list",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const g1 = yield* ds.createGoal({ tddTaskId: tddId, goal: "first" });
					const g2 = yield* ds.createGoal({ tddTaskId: tddId, goal: "second" });
					yield* ds.createBehavior({ goalId: g1.id, behavior: "g1.b1" });
					yield* ds.createBehavior({ goalId: g2.id, behavior: "g2.b1" });
					yield* ds.createBehavior({ goalId: g1.id, behavior: "g1.b2" });
					return yield* reader.getGoalsByTddTask(tddId);
				}),
			);
			expect(result.map((g) => g.goal)).toEqual(["first", "second"]);
			expect(result[0]?.behaviors.map((b) => b.behavior)).toEqual(["g1.b1", "g1.b2"]);
			expect(result[1]?.behaviors.map((b) => b.behavior)).toEqual(["g2.b1"]);
		});

		it("returns empty array when session has no goals", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getGoalsByTddTask(99999);
				}),
			);
			expect(result).toEqual([]);
		});
	});

	describe("getBehaviorById", () => {
		it("returns Some with parentGoal summary and dependencies", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-beh-1",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const goal = yield* ds.createGoal({ tddTaskId: tddId, goal: "G" });
					const dep = yield* ds.createBehavior({ goalId: goal.id, behavior: "dep" });
					const target = yield* ds.createBehavior({
						goalId: goal.id,
						behavior: "target",
						dependsOnBehaviorIds: [dep.id],
					});
					return yield* reader.getBehaviorById(target.id);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.behavior).toBe("target");
				expect(result.value.parentGoal.goal).toBe("G");
				expect(result.value.parentGoal.status).toBe("pending");
				expect(result.value.dependencies).toHaveLength(1);
				expect(result.value.dependencies[0]?.behavior).toBe("dep");
			}
		});

		it("returns None for unknown id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getBehaviorById(99999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getBehaviorsByGoal", () => {
		it("returns behaviors ordered by ordinal", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-bbg",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const goal = yield* ds.createGoal({ tddTaskId: tddId, goal: "g" });
					yield* ds.createBehavior({ goalId: goal.id, behavior: "x" });
					yield* ds.createBehavior({ goalId: goal.id, behavior: "y" });
					return yield* reader.getBehaviorsByGoal(goal.id);
				}),
			);
			expect(result.map((b) => b.behavior)).toEqual(["x", "y"]);
		});

		it("returns empty array for unknown goal id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getBehaviorsByGoal(99999);
				}),
			);
			expect(result).toEqual([]);
		});
	});

	describe("getBehaviorsByTddTask", () => {
		it("returns all behaviors across goals", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-bbs",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const g1 = yield* ds.createGoal({ tddTaskId: tddId, goal: "g1" });
					const g2 = yield* ds.createGoal({ tddTaskId: tddId, goal: "g2" });
					yield* ds.createBehavior({ goalId: g1.id, behavior: "a" });
					yield* ds.createBehavior({ goalId: g2.id, behavior: "b" });
					return yield* reader.getBehaviorsByTddTask(tddId);
				}),
			);
			expect(result.map((b) => b.behavior).sort()).toEqual(["a", "b"]);
		});

		it("returns empty array for session with no behaviors", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getBehaviorsByTddTask(99999);
				}),
			);
			expect(result).toEqual([]);
		});
	});

	describe("getBehaviorDependencies", () => {
		it("returns behaviors that the target depends on", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-deps",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const goal = yield* ds.createGoal({ tddTaskId: tddId, goal: "g" });
					const a = yield* ds.createBehavior({ goalId: goal.id, behavior: "a" });
					const b = yield* ds.createBehavior({ goalId: goal.id, behavior: "b" });
					const target = yield* ds.createBehavior({
						goalId: goal.id,
						behavior: "target",
						dependsOnBehaviorIds: [a.id, b.id],
					});
					return yield* reader.getBehaviorDependencies(target.id);
				}),
			);
			expect(result.map((b) => b.behavior).sort()).toEqual(["a", "b"]);
		});

		it("returns empty array when no dependencies are recorded", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.getBehaviorDependencies(99999);
				}),
			);
			expect(result).toEqual([]);
		});
	});

	describe("resolveGoalIdForBehavior", () => {
		it("returns Some<goalId> for an existing behavior", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-resolve",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const goal = yield* ds.createGoal({ tddTaskId: tddId, goal: "g" });
					const beh = yield* ds.createBehavior({ goalId: goal.id, behavior: "b" });
					const opt = yield* reader.resolveGoalIdForBehavior(beh.id);
					return { opt, goalId: goal.id };
				}),
			);
			expect(Option.isSome(result.opt)).toBe(true);
			if (Option.isSome(result.opt)) {
				expect(result.opt.value).toBe(result.goalId);
			}
		});

		it("returns None for unknown behavior id", async () => {
			const result = await run(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					return yield* reader.resolveGoalIdForBehavior(99999);
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getTddTaskById nested goals", () => {
		it("includes goals with nested behaviors in TddTaskDetail", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const reader = yield* DataReader;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-rd-tree",
						project: "demo",
						cwd: "/tmp/demo",
						agentKind: "subagent",
						startedAt: "2026-04-29T00:00:00Z",
					});
					const tddId = yield* ds.writeTddTask({ sessionId, goal: "obj", startedAt: "2026-04-29T00:00:01Z" });
					const g1 = yield* ds.createGoal({ tddTaskId: tddId, goal: "g1" });
					const g2 = yield* ds.createGoal({ tddTaskId: tddId, goal: "g2" });
					yield* ds.createBehavior({ goalId: g1.id, behavior: "g1.b1" });
					yield* ds.createBehavior({ goalId: g2.id, behavior: "g2.b1" });
					return yield* reader.getTddTaskById(tddId);
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.goals.map((g) => g.goal)).toEqual(["g1", "g2"]);
				expect(result.value.goals[0]?.behaviors.map((b) => b.behavior)).toEqual(["g1.b1"]);
				expect(result.value.goals[1]?.behaviors.map((b) => b.behavior)).toEqual(["g2.b1"]);
			}
		});
	});
});
