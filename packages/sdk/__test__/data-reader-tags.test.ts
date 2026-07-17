/**
 * Unit tests for listTagInventory and listTestsForTag on DataReaderLive.
 *
 * Covers:
 *   (1) listTagInventory() unscoped returns one row per (tag, project) pair
 *       from the tags / test_case_tags tables, latest run per project.
 *   (2) listTagInventory({ project }) filters to that project's latest run.
 *   (3) listTestsForTag("int") returns TestListEntry rows from each project's
 *       latest run.
 *   (4) listTestsForTag("int", { project }) scopes to one project.
 *   (5) Empty tag set returns [].
 *   (6) Tags belonging only to older runs are excluded.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import migration0001 from "../src/migrations/0001_initial.js";
import type { TagInventoryRow } from "../src/services/DataReader.js";
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

// Shared settings fixture
const settingsHash = "tag-test-hash";
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

const baseRunInput = {
	invocationId: "tag-inv-001",
	project: "tag-proj",
	settingsHash,
	timestamp: "2026-05-01T00:00:00.000Z",
	commitSha: "abc123",
	branch: "main",
	reason: "passed" as const,
	duration: 500,
	total: 2,
	passed: 2,
	failed: 0,
	skipped: 0,
	scoped: false,
};

// ─── Behavior 1 + structural ─────────────────────────────────────────────────

describe("TagInventoryRow type export", () => {
	it("should export TagInventoryRow type from the DataReader service module", () => {
		// If TagInventoryRow is exported, this type assertion compiles.
		// At runtime we just verify the import resolves (no undefined import).
		const row: TagInventoryRow = {
			tag: "int",
			project: "my-proj",
			moduleCount: 2,
			testCount: 3,
		};
		expect(row.tag).toBe("int");
		expect(row.project).toBe("my-proj");
		expect(row.moduleCount).toBe(2);
		expect(row.testCount).toBe(3);
	});
});

// ─── moduleCount: distinct-module aggregation ────────────────────────────────

describe("listTagInventory — moduleCount aggregation", () => {
	it("should count distinct test modules carrying the tag, not test cases", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings("tag-mc-hash", settingsInput, {});

				const runId = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-mc",
					project: "proj-mc",
					settingsHash: "tag-mc-hash",
				});

				const fileOne = yield* store.ensureFile("src/mc-one.test.ts");
				const fileTwo = yield* store.ensureFile("src/mc-two.test.ts");
				const fileThree = yield* store.ensureFile("src/mc-three.test.ts");
				const [modOne, modTwo, modThree] = yield* store.writeModules(runId, [
					{ fileId: fileOne, relativeModuleId: "src/mc-one.test.ts", state: "passed", duration: 10 },
					{ fileId: fileTwo, relativeModuleId: "src/mc-two.test.ts", state: "passed", duration: 10 },
					{ fileId: fileThree, relativeModuleId: "src/mc-three.test.ts", state: "passed", duration: 10 },
				]);

				// mc-one: two int-tagged tests in the same module → contributes 1 module, 2 tests.
				yield* store.writeTestCases(modOne, [
					{ name: "int one a", fullName: "mc-one > int a", state: "passed", tags: ["int"] },
					{ name: "int one b", fullName: "mc-one > int b", state: "passed", tags: ["int"] },
				]);
				// mc-two: one int-tagged test → +1 module, +1 test.
				yield* store.writeTestCases(modTwo, [
					{ name: "int two", fullName: "mc-two > int", state: "passed", tags: ["int"] },
				]);
				// mc-three: no int tag → does not contribute to int's counts.
				yield* store.writeTestCases(modThree, [
					{ name: "unit three", fullName: "mc-three > unit", state: "passed", tags: ["unit"] },
				]);

				return yield* reader.listTagInventory({ project: "proj-mc" });
			}),
		);

		const intRow = result.find((r) => r.tag === "int");
		expect(intRow).toBeDefined();
		expect(intRow?.moduleCount).toBe(2);
		expect(intRow?.testCount).toBe(3);

		const unitRow = result.find((r) => r.tag === "unit");
		expect(unitRow).toBeDefined();
		expect(unitRow?.moduleCount).toBe(1);
		expect(unitRow?.testCount).toBe(1);
	});
});

// ─── Behavior 5: empty tag set returns [] ────────────────────────────────────

describe("listTagInventory — empty tag set", () => {
	it("should return empty array when no tests have tags", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings(settingsHash, settingsInput, {});
				const runId = yield* store.writeRun(baseRunInput);
				const fileId = yield* store.ensureFile("src/no-tags.test.ts");
				const [moduleId] = yield* store.writeModules(runId, [
					{ fileId, relativeModuleId: "src/no-tags.test.ts", state: "passed", duration: 100 },
				]);
				yield* store.writeTestCases(moduleId, [
					{ name: "untagged test", fullName: "suite > untagged test", state: "passed" },
				]);

				return yield* reader.listTagInventory();
			}),
		);
		expect(result).toEqual([]);
	});
});

// ─── Behavior 1: unscoped listTagInventory ───────────────────────────────────

describe("listTagInventory — unscoped", () => {
	it("should return one row per tag-project pair from the latest run when called without project filter", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				// Project A — two tests, one tagged "int", one tagged "e2e"
				yield* store.writeSettings("tag-unsco-hash", settingsInput, {});
				const runA = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-unsco-a",
					project: "proj-a",
					settingsHash: "tag-unsco-hash",
				});
				const fileA = yield* store.ensureFile("src/a.test.ts");
				const [modA] = yield* store.writeModules(runA, [
					{ fileId: fileA, relativeModuleId: "src/a.test.ts", state: "passed", duration: 50 },
				]);
				yield* store.writeTestCases(modA, [
					{ name: "int test 1", fullName: "suite > int test 1", state: "passed", tags: ["int"] },
					{ name: "e2e test 1", fullName: "suite > e2e test 1", state: "passed", tags: ["e2e"] },
				]);

				// Project B — one test tagged "int"
				const runB = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-unsco-b",
					project: "proj-b",
					settingsHash: "tag-unsco-hash",
				});
				const fileB = yield* store.ensureFile("src/b.test.ts");
				const [modB] = yield* store.writeModules(runB, [
					{ fileId: fileB, relativeModuleId: "src/b.test.ts", state: "passed", duration: 30 },
				]);
				yield* store.writeTestCases(modB, [
					{ name: "int test b", fullName: "suite > int test b", state: "passed", tags: ["int"] },
				]);

				return yield* reader.listTagInventory();
			}),
		);

		// Expect 3 rows: (int, proj-a), (e2e, proj-a), (int, proj-b)
		expect(result.length).toBe(3);

		const intA = result.find((r) => r.tag === "int" && r.project === "proj-a");
		expect(intA).toBeDefined();
		expect(intA?.testCount).toBe(1);
		expect(intA?.moduleCount).toBe(1);

		const e2eA = result.find((r) => r.tag === "e2e" && r.project === "proj-a");
		expect(e2eA).toBeDefined();
		expect(e2eA?.testCount).toBe(1);
		expect(e2eA?.moduleCount).toBe(1);

		const intB = result.find((r) => r.tag === "int" && r.project === "proj-b");
		expect(intB).toBeDefined();
		expect(intB?.testCount).toBe(1);
		expect(intB?.moduleCount).toBe(1);
	});
});

// ─── Behavior 2: project-scoped listTagInventory ─────────────────────────────

describe("listTagInventory — project scoped", () => {
	it("should return only rows for the specified project when called with project filter", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings("tag-scope-hash", settingsInput, {});

				// proj-x: tagged "int" and "unit"
				const runX = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-scope-x",
					project: "proj-x",
					settingsHash: "tag-scope-hash",
				});
				const fileX = yield* store.ensureFile("src/x.test.ts");
				const [modX] = yield* store.writeModules(runX, [
					{ fileId: fileX, relativeModuleId: "src/x.test.ts", state: "passed", duration: 40 },
				]);
				yield* store.writeTestCases(modX, [
					{ name: "test x1", fullName: "x > test x1", state: "passed", tags: ["int"] },
					{ name: "test x2", fullName: "x > test x2", state: "passed", tags: ["unit"] },
				]);

				// proj-y: tagged "e2e"
				const runY = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-scope-y",
					project: "proj-y",
					settingsHash: "tag-scope-hash",
				});
				const fileY = yield* store.ensureFile("src/y.test.ts");
				const [modY] = yield* store.writeModules(runY, [
					{ fileId: fileY, relativeModuleId: "src/y.test.ts", state: "passed", duration: 25 },
				]);
				yield* store.writeTestCases(modY, [
					{ name: "test y1", fullName: "y > test y1", state: "passed", tags: ["e2e"] },
				]);

				return yield* reader.listTagInventory({ project: "proj-x" });
			}),
		);

		// Only proj-x rows
		expect(result.every((r) => r.project === "proj-x")).toBe(true);
		expect(result.length).toBe(2);
		const tags = result.map((r) => r.tag).sort();
		expect(tags).toEqual(["int", "unit"]);
		for (const r of result) {
			expect(r.moduleCount).toBe(1);
			expect(r.testCount).toBe(1);
		}
	});
});

// ─── Behavior 3: unscoped listTestsForTag ────────────────────────────────────

describe("listTestsForTag — unscoped", () => {
	it("should return TestListEntry rows for tests tagged with the given tag from the latest run of each project", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings("tag-tft-hash", settingsInput, {});

				// proj-alpha: two tests — one with "int", one without
				const runAlpha = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-tft-alpha",
					project: "proj-alpha",
					settingsHash: "tag-tft-hash",
				});
				const fileAlpha = yield* store.ensureFile("src/alpha.test.ts");
				const [modAlpha] = yield* store.writeModules(runAlpha, [
					{ fileId: fileAlpha, relativeModuleId: "src/alpha.test.ts", state: "passed", duration: 60 },
				]);
				yield* store.writeTestCases(modAlpha, [
					{ name: "int alpha", fullName: "alpha > int alpha", state: "passed", tags: ["int"] },
					{ name: "plain alpha", fullName: "alpha > plain alpha", state: "passed" },
				]);

				// proj-beta: one test with "int"
				const runBeta = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-tft-beta",
					project: "proj-beta",
					settingsHash: "tag-tft-hash",
				});
				const fileBeta = yield* store.ensureFile("src/beta.test.ts");
				const [modBeta] = yield* store.writeModules(runBeta, [
					{ fileId: fileBeta, relativeModuleId: "src/beta.test.ts", state: "passed", duration: 35 },
				]);
				yield* store.writeTestCases(modBeta, [
					{ name: "int beta", fullName: "beta > int beta", state: "passed", tags: ["int"] },
				]);

				return yield* reader.listTestsForTag("int");
			}),
		);

		// Should return exactly the two "int"-tagged tests
		expect(result.length).toBe(2);
		const fullNames = result.map((t) => t.fullName).sort();
		expect(fullNames).toEqual(["alpha > int alpha", "beta > int beta"]);

		// Each entry should have TestListEntry shape
		for (const entry of result) {
			expect(typeof entry.id).toBe("number");
			expect(typeof entry.fullName).toBe("string");
			expect(typeof entry.state).toBe("string");
			expect(typeof entry.module).toBe("string");
		}
	});
});

// ─── Behavior 4: project-scoped listTestsForTag ──────────────────────────────

describe("listTestsForTag — project scoped", () => {
	it("should return only tests from the specified project when called with project option", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings("tag-tft-scope-hash", settingsInput, {});

				// proj-p: test with "int"
				const runP = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-tft-p",
					project: "proj-p",
					settingsHash: "tag-tft-scope-hash",
				});
				const fileP = yield* store.ensureFile("src/p.test.ts");
				const [modP] = yield* store.writeModules(runP, [
					{ fileId: fileP, relativeModuleId: "src/p.test.ts", state: "passed", duration: 20 },
				]);
				yield* store.writeTestCases(modP, [{ name: "int p", fullName: "p > int p", state: "passed", tags: ["int"] }]);

				// proj-q: test with "int" too, but we'll filter to proj-p only
				const runQ = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-tft-q",
					project: "proj-q",
					settingsHash: "tag-tft-scope-hash",
				});
				const fileQ = yield* store.ensureFile("src/q.test.ts");
				const [modQ] = yield* store.writeModules(runQ, [
					{ fileId: fileQ, relativeModuleId: "src/q.test.ts", state: "passed", duration: 15 },
				]);
				yield* store.writeTestCases(modQ, [{ name: "int q", fullName: "q > int q", state: "passed", tags: ["int"] }]);

				return yield* reader.listTestsForTag("int", { project: "proj-p" });
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].fullName).toBe("p > int p");
	});
});

// ─── Behavior 6: older runs are excluded ─────────────────────────────────────

describe("listTagInventory + listTestsForTag — older run exclusion", () => {
	it("should exclude tags that only appear in older runs and not in the latest run", async () => {
		const { inventoryResult, testsResult } = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;

				yield* store.writeSettings("tag-old-hash", settingsInput, {});

				// Older run: has test tagged "old-tag"
				const oldRun = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-old-run",
					project: "proj-old",
					settingsHash: "tag-old-hash",
					timestamp: "2026-04-01T00:00:00.000Z",
				});
				const fileOld = yield* store.ensureFile("src/old.test.ts");
				const [modOld] = yield* store.writeModules(oldRun, [
					{ fileId: fileOld, relativeModuleId: "src/old.test.ts", state: "passed", duration: 100 },
				]);
				yield* store.writeTestCases(modOld, [
					{ name: "old tagged test", fullName: "old > old tagged test", state: "passed", tags: ["old-tag"] },
				]);

				// Newer run (same project): no tags at all
				const newRun = yield* store.writeRun({
					...baseRunInput,
					invocationId: "tag-new-run",
					project: "proj-old",
					settingsHash: "tag-old-hash",
					timestamp: "2026-05-01T00:00:00.000Z",
				});
				const fileNew = yield* store.ensureFile("src/new.test.ts");
				const [modNew] = yield* store.writeModules(newRun, [
					{ fileId: fileNew, relativeModuleId: "src/new.test.ts", state: "passed", duration: 80 },
				]);
				yield* store.writeTestCases(modNew, [
					{ name: "new untagged test", fullName: "new > new untagged test", state: "passed" },
				]);

				const inventoryResult = yield* reader.listTagInventory({ project: "proj-old" });
				const testsResult = yield* reader.listTestsForTag("old-tag", { project: "proj-old" });

				return { inventoryResult, testsResult };
			}),
		);

		// "old-tag" only existed in the older run — should be excluded from both
		expect(inventoryResult).toEqual([]);
		expect(testsResult).toEqual([]);
	});
});
