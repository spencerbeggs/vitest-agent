import { Effect, Exit } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";
import { withPersistSavepoint, withPersistTransaction } from "../src/utils/persist-transaction.js";

const settingsInput = { vitestVersion: "5.0.0" };

const runInput = (project: string) => ({
	invocationId: `inv-${project}`,
	project,
	settingsHash: "h",
	timestamp: "2026-10-01T00:00:00.000Z",
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

/** `test_modules.file_id` values no `files` row backs -- must stay 0 under PRAGMA foreign_keys. */
const danglingModuleFiles = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const rows = yield* sql<{
		c: number;
	}>`SELECT count(*) AS c FROM test_modules m LEFT JOIN files f ON f.id = m.file_id WHERE f.id IS NULL`;
	return rows[0].c;
});

const fileRows = Effect.gen(function* () {
	const sql = yield* SqlClient;
	return yield* sql<{ id: number; path: string }>`SELECT id, path FROM files ORDER BY id`;
});

const tagRows = Effect.gen(function* () {
	const sql = yield* SqlClient;
	return yield* sql<{ id: number; name: string }>`SELECT id, name FROM tags ORDER BY id`;
});

/** `test_case_tags.tag_id` values no `tags` row backs. */
const danglingCaseTags = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const rows = yield* sql<{
		c: number;
	}>`SELECT count(*) AS c FROM test_case_tags ct LEFT JOIN tags t ON t.id = ct.tag_id WHERE t.id IS NULL`;
	return rows[0].c;
});

describe("withPersistSavepoint", () => {
	it("discards a file id cached inside a rolled-back savepoint, so a later write does not reuse it", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				yield* withPersistTransaction(
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.writeSettings("h", settingsInput, {});
						const runId = yield* store.writeRun(runInput("p1"));
						// A nested write inserts a new files row, caches its id, then fails:
						// the savepoint rolls the row back. The caller recovers and goes on.
						const failed = yield* Effect.exit(
							withPersistSavepoint(
								Effect.gen(function* () {
									yield* store.ensureFile("p1/a.test.ts");
									return yield* Effect.fail("boom" as const);
								}),
							),
						);
						expect(failed).toEqual(Exit.fail("boom"));
						// The same path again: must re-insert, not hand back the dead id.
						const fileId = yield* store.ensureFile("p1/a.test.ts");
						yield* store.writeModules(runId, [{ fileId, relativeModuleId: "p1/a.test.ts", state: "passed" }]);
					}),
				);
				return { files: yield* fileRows, dangling: yield* danglingModuleFiles };
			}).pipe(Effect.provide(makeTestLayer(":memory:"))),
		);
		expect(result.files.map((r) => r.path)).toEqual(["p1/a.test.ts"]);
		expect(result.dangling).toBe(0);
	});

	it("discards a tag id cached inside a rolled-back savepoint", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				yield* withPersistTransaction(
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.writeSettings("h", settingsInput, {});
						const runId = yield* store.writeRun(runInput("p1"));
						const fileId = yield* store.ensureFile("p1/a.test.ts");
						const [moduleId] = yield* store.writeModules(runId, [
							{ fileId, relativeModuleId: "p1/a.test.ts", state: "passed" },
						]);
						const failed = yield* Effect.exit(
							withPersistSavepoint(
								Effect.gen(function* () {
									yield* store.writeTestCases(moduleId, [
										{ name: "one", fullName: "s > one", state: "passed", tags: ["unit"] },
									]);
									return yield* Effect.fail("boom" as const);
								}),
							),
						);
						expect(failed).toEqual(Exit.fail("boom"));
						yield* store.writeTestCases(moduleId, [
							{ name: "two", fullName: "s > two", state: "passed", tags: ["unit"] },
						]);
					}),
				);
				return { tags: yield* tagRows, dangling: yield* danglingCaseTags };
			}).pipe(Effect.provide(makeTestLayer(":memory:"))),
		);
		expect(result.tags.map((r) => r.name)).toEqual(["unit"]);
		expect(result.dangling).toBe(0);
	});

	it("keeps ids cached inside a savepoint that commits (control: the snapshot is not blindly restored)", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				yield* withPersistTransaction(
					Effect.gen(function* () {
						const store = yield* DataStore;
						yield* store.writeSettings("h", settingsInput, {});
						const runId = yield* store.writeRun(runInput("p1"));
						const inner = yield* withPersistSavepoint(store.ensureFile("p1/a.test.ts"));
						const outer = yield* store.ensureFile("p1/a.test.ts");
						expect(outer).toBe(inner);
						yield* store.writeModules(runId, [{ fileId: outer, relativeModuleId: "p1/a.test.ts", state: "passed" }]);
					}),
				);
				return { files: yield* fileRows, dangling: yield* danglingModuleFiles };
			}).pipe(Effect.provide(makeTestLayer(":memory:"))),
		);
		expect(result.files).toHaveLength(1);
		expect(result.dangling).toBe(0);
	});

	it("is a plain transaction outside a batch", async () => {
		const count = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const failed = yield* Effect.exit(
					withPersistSavepoint(
						Effect.gen(function* () {
							yield* store.ensureFile("p1/a.test.ts");
							return yield* Effect.fail("boom" as const);
						}),
					),
				);
				expect(failed).toEqual(Exit.fail("boom"));
				return (yield* fileRows).length;
			}).pipe(Effect.provide(makeTestLayer(":memory:"))),
		);
		expect(count).toBe(0);
	});
});
