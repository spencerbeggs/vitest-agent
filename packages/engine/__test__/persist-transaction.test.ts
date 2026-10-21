import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Duration, Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";
import { withPersistTransaction } from "../src/utils/persist-transaction.js";

const settingsInput = { vitestVersion: "5.0.0" };

const runInput = (project: string, timestamp: string) => ({
	invocationId: `inv-${project}-${timestamp}`,
	project,
	settingsHash: "h",
	timestamp,
	commitSha: null,
	branch: null,
	reason: "passed" as const,
	duration: 1,
	total: 1,
	passed: 1,
	failed: 0,
	skipped: 0,
	scoped: false,
});

const count = (table: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const rows = yield* sql<{ c: number }>`SELECT count(*) AS c FROM ${sql(table)}`;
		return rows[0].c;
	});

/** One run's worth of writes: a run row, a module, two tagged tests, their history. */
const writeOneRun = (project: string, timestamp: string) =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.writeSettings("h", settingsInput, {});
		const runId = yield* store.writeRun(runInput(project, timestamp));
		const fileId = yield* store.ensureFile(`${project}/a.test.ts`);
		const [moduleId] = yield* store.writeModules(runId, [
			{ fileId, relativeModuleId: `${project}/a.test.ts`, state: "passed" },
		]);
		yield* store.writeTestCases(moduleId, [
			{ name: "one", fullName: "s > one", state: "passed", tags: ["unit", "fast"] },
			{ name: "two", fullName: "s > two", state: "failed", tags: ["unit"] },
		]);
		for (const fullName of ["s > one", "s > two"]) {
			yield* store.writeHistory(
				project,
				fullName,
				`${project}/a.test.ts`,
				runId,
				timestamp,
				"passed",
				1,
				false,
				0,
				null,
			);
		}
		return runId;
	});

const ts = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;

/** Every history row, in a stable order, without the surrogate id / run_id. */
const historyRows = Effect.gen(function* () {
	const sql = yield* SqlClient;
	return yield* sql<{
		project: string;
		module_path: string;
		full_name: string;
		timestamp: string;
	}>`SELECT project, module_path, full_name, timestamp FROM test_history ORDER BY project, module_path, full_name, timestamp`;
});

/** A series no run writes, seeded past the window directly. */
const seedForeignSeries = Effect.gen(function* () {
	const store = yield* DataStore;
	const sql = yield* SqlClient;
	yield* store.writeSettings("h", settingsInput, {});
	const runId = yield* store.writeRun(runInput("p1", "2026-09-01T00:00:00.000Z"));
	for (let i = 0; i < 12; i++) {
		yield* sql`INSERT INTO test_history (run_id, project, module_path, full_name, timestamp, state, flaky, retry_count) VALUES (${runId}, 'p1', 'p1/other.test.ts', 'untouched', ${`2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`}, 'passed', 0, 0)`;
	}
});

describe("withPersistTransaction", () => {
	it("rolls back every write of the block when it fails midway", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				const failed = yield* Effect.exit(
					withPersistTransaction(
						Effect.gen(function* () {
							const store = yield* DataStore;
							yield* writeOneRun("p1", ts(0));
							// A nested transaction inside the block becomes a savepoint.
							yield* store.writeThresholds({ global: { lines: 80 }, perFile: false, patterns: [] });
							return yield* Effect.fail("boom" as const);
						}),
					),
				);
				return {
					failed,
					runs: yield* count("test_runs"),
					cases: yield* count("test_cases"),
					tags: yield* count("tags"),
					caseTags: yield* count("test_case_tags"),
					files: yield* count("files"),
					history: yield* count("test_history"),
					policy: yield* count("coverage_baselines"),
				};
			}).pipe(Effect.provide(makeTestLayer(":memory:"))),
		);
		expect(Exit.isSuccess(exit)).toBe(true);
		if (!Exit.isSuccess(exit)) return;
		const { failed, ...counts } = exit.value;
		// The block's own error comes back unchanged.
		expect(failed).toEqual(Exit.fail("boom"));
		expect(counts).toEqual({ runs: 0, cases: 0, tags: 0, caseTags: 0, files: 0, history: 0, policy: 0 });
	});

	it("writes the same rows as the unbatched path (control: the same writes without the block persist partially)", async () => {
		const counts = (wrap: boolean) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const body = Effect.gen(function* () {
						yield* writeOneRun("p1", ts(0));
						yield* writeOneRun("p2", ts(0));
					});
					yield* wrap ? withPersistTransaction(body) : body;
					return {
						runs: yield* count("test_runs"),
						cases: yield* count("test_cases"),
						tags: yield* count("tags"),
						caseTags: yield* count("test_case_tags"),
						files: yield* count("files"),
						history: yield* count("test_history"),
					};
				}).pipe(Effect.provide(makeTestLayer(":memory:"))),
			);
		const unbatched = await counts(false);
		expect(unbatched).toEqual({ runs: 2, cases: 4, tags: 2, caseTags: 6, files: 2, history: 4 });
		expect(await counts(true)).toEqual(unbatched);
	});

	it("keeps the newest 10 history rows per series, exactly as the per-write prune does", async () => {
		const history = (wrap: boolean) =>
			Effect.runPromise(
				Effect.gen(function* () {
					yield* seedForeignSeries;
					for (let i = 0; i < 12; i++) {
						// Two projects per transaction, like a multi-project reporter run.
						const body = Effect.gen(function* () {
							yield* writeOneRun("p1", ts(i));
							yield* writeOneRun("p2", ts(i));
						});
						yield* wrap ? withPersistTransaction(body) : body;
					}
					return yield* historyRows;
				}).pipe(Effect.provide(makeTestLayer(":memory:"))),
			);
		const unbatched = await history(false);
		const batched = await history(true);
		expect(batched).toEqual(unbatched);

		const series = (project: string, fullName: string) =>
			batched.filter((r) => r.project === project && r.full_name === fullName).map((r) => r.timestamp);
		const newestTen = Array.from({ length: 10 }, (_, i) => ts(i + 2));
		expect(series("p1", "s > one")).toEqual(newestTen);
		expect(series("p2", "s > two")).toEqual(newestTen);
		// A series this run never wrote is not pruned by either path.
		expect(series("p1", "untouched")).toHaveLength(12);
	});

	describe("two connections in one process", () => {
		let dir: string;
		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-tx-"));
		});
		afterEach(() => {
			fs.rmSync(dir, { recursive: true, force: true });
		});

		// One reporter instance per Vitest project, each with its own
		// connection, all running their persist phase concurrently on one
		// event loop. A short busy timeout keeps the control fast: it fails
		// with SQLITE_BUSY instead of stalling for the 5 s default.
		const connection = (filename: string) => {
			const client = sqliteClientLayer({ filename, busyTimeout: Duration.millis(200) });
			return Layer.merge(DataStoreLive.pipe(Layer.provide(client)), client);
		};
		const concurrently = async (wrap: (body: Effect.Effect<void, unknown, DataStore | SqlClient>) => typeof body) => {
			const filename = path.join(dir, "data.db");
			await Effect.runPromise(Effect.provide(Effect.void, makeTestLayer(filename)));
			const persist = (project: string) =>
				Effect.runPromiseExit(
					wrap(
						Effect.gen(function* () {
							for (let i = 0; i < 300; i++) yield* writeOneRun(project, ts(i % 28));
						}),
					).pipe(Effect.provide(connection(filename))),
				);
			return Promise.all([persist("p1"), persist("p2")]);
		};

		it("persists both runs without SQLITE_BUSY", async () => {
			const exits = await concurrently(withPersistTransaction);
			expect(exits.map(Exit.isSuccess)).toEqual([true, true]);
		});

		it("control: a plain transaction that yields mid-write locks the other connection out", async () => {
			const exits = await concurrently((body) => Effect.flatMap(SqlClient, (sql) => sql.withTransaction(body)));
			expect(exits.map(Exit.isSuccess)).toContain(false);
		});
	});
});
