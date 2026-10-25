/**
 * `DataStore.pruneRuns` — the run-retention policy for `data.db` (issue 623).
 *
 * Every `test_runs` row beyond the newest N per project (and any older than
 * the age limit) is deleted; the schema's cascades remove the dependent
 * rows; `files` rows nothing references any more are garbage-collected;
 * `test_history` rows survive with a NULL `run_id` so classification keeps
 * working.
 */

import { RunRetentionPolicy } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";
import { makeTestLayer } from "../src/testing/layers.js";
import { withPersistTransaction } from "../src/utils/persist-transaction.js";

const runInput = (project: string, timestamp: string, invocationId = `inv-${project}-${timestamp}`) => ({
	invocationId,
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

/** `2026-10-<day>` — monotonic timestamps within one month. */
const ts = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const count = (table: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const rows = yield* sql<{ c: number }>`SELECT count(*) AS c FROM ${sql(table)}`;
		return rows[0].c;
	});

/**
 * One run with a module over `<project>/<file>.test.ts`, two tagged tests
 * (one failing with a stack frame into `<project>/src/<file>.ts`), a
 * coverage row, a trend row and history for both tests.
 */
const writeRun = (project: string, day: number, file = "a") =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		const timestamp = ts(day);
		yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
		const runId = yield* store.writeRun(runInput(project, timestamp));
		const testFileId = yield* store.ensureFile(`${project}/${file}.test.ts`);
		const sourceFileId = yield* store.ensureFile(`${project}/src/${file}.ts`);
		const [moduleId] = yield* store.writeModules(runId, [
			{ fileId: testFileId, relativeModuleId: `${project}/${file}.test.ts`, state: "failed" },
		]);
		const caseIds = yield* store.writeTestCases(moduleId, [
			{ name: "one", fullName: "s > one", state: "passed", tags: ["unit"] },
			{ name: "two", fullName: "s > two", state: "failed", tags: ["unit", "slow"] },
		]);
		yield* store.writeErrors(runId, [
			{
				testCaseId: caseIds[1],
				scope: "test",
				message: "boom",
				frames: [{ ordinal: 0, method: "fn", filePath: `${project}/src/${file}.ts`, line: 1, col: 1 }],
			},
		]);
		yield* store.writeCoverage(runId, [
			{ fileId: sourceFileId, statements: 50, branches: 50, functions: 50, lines: 50, tier: "below_threshold" },
		]);
		yield* store.writeTrends(project, runId, {
			timestamp,
			coverage: { lines: 50, branches: 50, functions: 50, statements: 50 },
			delta: { lines: 0, branches: 0, functions: 0, statements: 0 },
			direction: "stable",
		});
		for (const fullName of ["s > one", "s > two"]) {
			yield* store.writeHistory(
				project,
				fullName,
				`${project}/${file}.test.ts`,
				runId,
				timestamp,
				fullName === "s > two" ? "failed" : "passed",
				1,
				false,
				0,
				null,
			);
		}
		return runId;
	});

const runIds = (project?: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const rows =
			project === undefined
				? yield* sql<{ id: number }>`SELECT id FROM test_runs ORDER BY id`
				: yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE project = ${project} ORDER BY id`;
		return rows.map((r) => r.id);
	});

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(":memory:")));

describe("DataStore.pruneRuns", () => {
	it("keeps the newest N runs of EVERY project, counting what it deleted", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				for (let day = 1; day <= 5; day++) yield* writeRun("alpha", day);
				for (let day = 1; day <= 3; day++) yield* writeRun("beta", day);
				const alphaBefore = yield* runIds("alpha");
				const betaBefore = yield* runIds("beta");
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 2 }));
				return { pruned, alphaBefore, betaBefore, alpha: yield* runIds("alpha"), beta: yield* runIds("beta") };
			}),
		);
		expect(result.pruned.prunedRuns).toBe(4);
		expect(result.alpha).toEqual(result.alphaBefore.slice(-2));
		expect(result.beta).toEqual(result.betaBefore.slice(-2));
	});

	it("is a no-op when every project has at most N runs", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* writeRun("alpha", 1);
				yield* writeRun("alpha", 2);
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 2 }));
				return { pruned, runs: yield* count("test_runs"), files: yield* count("files") };
			}),
		);
		expect(result.pruned).toEqual({ prunedRuns: 0, prunedFiles: 0 });
		expect(result.runs).toBe(2);
		expect(result.files).toBe(2);
	});

	it("drops runs older than maxAgeDays even inside the newest N", async () => {
		const now = new Date();
		const recent = now.toISOString();
		const old = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
				const oldId = yield* store.writeRun(runInput("alpha", old));
				const recentId = yield* store.writeRun(runInput("alpha", recent));
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 100, maxAgeDays: 30 }));
				return { pruned, oldId, recentId, remaining: yield* runIds() };
			}),
		);
		expect(result.pruned.prunedRuns).toBe(1);
		expect(result.remaining).toEqual([result.recentId]);
	});

	it("cascades a pruned run's modules, cases, tags, errors, frames, coverage and trends", async () => {
		const before = await run(
			Effect.gen(function* () {
				yield* writeRun("alpha", 1);
				return {
					modules: yield* count("test_modules"),
					cases: yield* count("test_cases"),
					caseTags: yield* count("test_case_tags"),
					errors: yield* count("test_errors"),
					frames: yield* count("stack_frames"),
					coverage: yield* count("file_coverage"),
					trends: yield* count("coverage_trends"),
				};
			}),
		);
		// The fixture must populate every table the assertion below checks.
		for (const [table, n] of Object.entries(before)) {
			expect(n, table).toBeGreaterThan(0);
		}

		const after = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* writeRun("alpha", 1, "old");
				yield* writeRun("alpha", 2, "new");
				yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				return {
					runs: yield* count("test_runs"),
					modules: yield* count("test_modules"),
					cases: yield* count("test_cases"),
					caseTags: yield* count("test_case_tags"),
					errors: yield* count("test_errors"),
					frames: yield* count("stack_frames"),
					coverage: yield* count("file_coverage"),
					trends: yield* count("coverage_trends"),
				};
			}),
		);
		expect(after).toEqual({ runs: 1, ...before });
	});

	it("garbage-collects files only the pruned runs referenced and keeps shared ones", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sql = yield* SqlClient;
				yield* writeRun("alpha", 1, "old"); // alpha/old.test.ts + alpha/src/old.ts
				yield* writeRun("alpha", 2, "shared");
				yield* writeRun("alpha", 3, "shared");
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				const paths = yield* sql<{ path: string }>`SELECT path FROM files ORDER BY path`;
				return { pruned, paths: paths.map((p) => p.path) };
			}),
		);
		expect(result.pruned.prunedRuns).toBe(2);
		expect(result.pruned.prunedFiles).toBe(2);
		expect(result.paths).toEqual(["alpha/shared.test.ts", "alpha/src/shared.ts"]);
	});

	it("never GCs a file another table still references (file_edits, tdd_artifacts, source_test_map)", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sql = yield* SqlClient;
				yield* writeRun("alpha", 1, "old");
				const keptRunId = yield* writeRun("alpha", 2, "new");
				const artifactId = yield* store.ensureFile("artifact.ts");
				yield* store.ensureFile("orphan.ts");
				// file_edits.file_id — a turn's edit of a file no run ever touched.
				const sessionId = yield* store.writeSession({
					chatId: "chat-1",
					project: "alpha",
					cwd: "/w",
					agentKind: "main",
					startedAt: ts(1),
				});
				yield* store.writeTurn({
					sessionId,
					type: "file_edit",
					payload: JSON.stringify({ file_path: "edited.ts", edit_kind: "edit" }),
					occurredAt: ts(1),
				});
				// tdd_artifacts.file_id
				const tddTaskId = yield* store.writeTddTask({ sessionId, goal: "g", startedAt: ts(1) });
				const phase = yield* store.writeTddPhase({ tddTaskId, phase: "red", startedAt: ts(1) });
				yield* store.writeTddArtifact({
					phaseId: phase.id,
					artifactKind: "test_written",
					fileId: artifactId,
					recordedAt: ts(1),
				});
				// source_test_map.source_file_id against the kept run's module.
				const modules = yield* sql<{ id: number }>`SELECT id FROM test_modules WHERE run_id = ${keptRunId}`;
				yield* store.writeSourceMap("mapped.ts", modules[0].id, "import_analysis");
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				const paths = yield* sql<{ path: string }>`SELECT path FROM files ORDER BY path`;
				return { pruned, paths: paths.map((p) => p.path) };
			}),
		);
		expect(result.paths).toEqual(["alpha/new.test.ts", "alpha/src/new.ts", "artifact.ts", "edited.ts", "mapped.ts"]);
		// alpha/old.test.ts, alpha/src/old.ts and the never-referenced orphan.ts.
		expect(result.pruned.prunedFiles).toBe(3);
	});

	it("keeps test_history rows of a pruned run, with run_id set to NULL", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sql = yield* SqlClient;
				const prunedRunId = yield* writeRun("alpha", 1);
				const keptRunId = yield* writeRun("alpha", 2);
				yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				const rows = yield* sql<{
					run_id: number | null;
					timestamp: string;
					state: string;
				}>`SELECT run_id, timestamp, state FROM test_history WHERE full_name = 's > two' ORDER BY timestamp`;
				return { prunedRunId, keptRunId, rows };
			}),
		);
		expect(result.rows).toEqual([
			{ run_id: null, timestamp: ts(1), state: "failed" },
			{ run_id: result.keptRunId, timestamp: ts(2), state: "failed" },
		]);
	});

	it("never prunes the run just written inside the persist transaction", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				for (let day = 1; day <= 3; day++) yield* writeRun("alpha", day);
				const newest = yield* withPersistTransaction(
					Effect.gen(function* () {
						const id = yield* writeRun("alpha", 4);
						yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
						return id;
					}),
				);
				return { newest, remaining: yield* runIds(), history: yield* count("test_history") };
			}),
		);
		expect(result.remaining).toEqual([result.newest]);
		// Two series, four runs each: history is bounded by its own keep-10 window, not by run retention.
		expect(result.history).toBe(8);
	});

	/**
	 * Coverage is written once per invocation under the first project's run
	 * (issue 622); readers resolve a project's rows through the lowest
	 * sibling run of the invocation.
	 */
	const writeInvocation = (invocationId: string, day: number, coverageUnder: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("h", { vitestVersion: "5.0.0" }, {});
			const ids: Record<string, number> = {};
			for (const project of ["alpha", "beta"]) {
				const runId = yield* store.writeRun(runInput(project, ts(day), invocationId));
				ids[project] = runId;
				const fileId = yield* store.ensureFile(`${project}/a.test.ts`);
				yield* store.writeModules(runId, [{ fileId, relativeModuleId: `${project}/a.test.ts`, state: "passed" }]);
				if (coverageUnder.includes(project)) {
					const sourceId = yield* store.ensureFile(`src/shared-${day}.ts`);
					yield* store.writeCoverage(runId, [
						{ fileId: sourceId, statements: 50, branches: 50, functions: 50, lines: 50, tier: "below_threshold" },
					]);
				}
			}
			return ids;
		});

	const coverageByRun = Effect.gen(function* () {
		const sql = yield* SqlClient;
		const rows = yield* sql<{ run_id: number; c: number }>`
			SELECT run_id, count(*) AS c FROM file_coverage GROUP BY run_id ORDER BY run_id`;
		return rows.map((r) => [r.run_id, r.c] as const);
	});

	it("moves an invocation's coverage rows to the surviving sibling run when the holder is pruned", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const reader = yield* DataReader;
				// Invocation 1: alpha + beta, coverage under alpha's run only (post-622 shape).
				const first = yield* writeInvocation("inv-1", 1, ["alpha"]);
				// Invocation 2: alpha alone (a --project run), so alpha has two runs and beta one.
				yield* store.writeRun(runInput("alpha", ts(2), "inv-2"));
				const pruned = yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				const coverage = yield* reader.getCoverage("beta");
				return { first, pruned, byRun: yield* coverageByRun, coverage: Option.getOrUndefined(coverage) };
			}),
		);
		expect(result.pruned.prunedRuns).toBe(1);
		// The rows alpha's pruned run held now sit under beta's surviving run of the same invocation.
		expect(result.byRun).toEqual([[result.first.beta, 1]]);
		expect(result.coverage?.lowCoverage.map((f) => f.file)).toEqual(["src/shared-1.ts"]);
	});

	it("does not duplicate coverage when the surviving sibling already carries its own copy (pre-622 databases)", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const first = yield* writeInvocation("inv-1", 1, ["alpha", "beta"]);
				yield* store.writeRun(runInput("alpha", ts(2), "inv-2"));
				yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				return { first, byRun: yield* coverageByRun };
			}),
		);
		expect(result.byRun).toEqual([[result.first.beta, 1]]);
	});

	it("lets coverage cascade when every run of the invocation is pruned", async () => {
		const result = await run(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* writeInvocation("inv-1", 1, ["alpha"]);
				const second = yield* writeInvocation("inv-2", 2, ["alpha"]);
				yield* store.pruneRuns(RunRetentionPolicy.make({ keepRuns: 1 }));
				return { second, byRun: yield* coverageByRun, runs: yield* count("test_runs") };
			}),
		);
		expect(result.runs).toBe(2);
		expect(result.byRun).toEqual([[result.second.alpha, 1]]);
	});
});
