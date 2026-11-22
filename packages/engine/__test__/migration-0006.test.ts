import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import migration0001 from "../src/migrations/0001_initial.js";
import migration0002 from "../src/migrations/0002_test_artifacts.js";
import migration0003 from "../src/migrations/0003_run_retention.js";
import migration0004 from "../src/migrations/0004_stray_output.js";
import migration0005 from "../src/migrations/0005_scrub_ci_env_vars.js";
import { PROJECT_MIGRATIONS } from "../src/migrations/index.js";

type Record = globalThis.Record<string, Effect.Effect<void, unknown, SqlClient>>;

const migrateWithFile = (filename: string, record: Record) => {
	const SqliteLayer = sqliteClientLayer({ filename });
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(record as never),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);
};

const upTo0005: Record = {
	"0001_initial": migration0001,
	"0002_test_artifacts": migration0002,
	"0003_run_retention": migration0003,
	"0004_stray_output": migration0004,
	"0005_scrub_ci_env_vars": migration0005,
};

const ATTEMPT_COLUMNS = ["id", "test_case_id", "retry_index", "repeat_index", "state", "duration", "start_time"];

const shape = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const attempts = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info('test_attempts') ORDER BY cid`;
	const attemptId = yield* sql<{ name: string; notnull: number }>`
		SELECT name, "notnull" FROM pragma_table_info('test_errors') WHERE name = 'attempt_id'`;
	return { attempts: attempts.map((c) => c.name), attemptId };
});

describe("0006_test_attempts", () => {
	it("is registered in PROJECT_MIGRATIONS after 0005", () => {
		expect(Object.keys(PROJECT_MIGRATIONS).slice(0, 6)).toEqual([
			"0001_initial",
			"0002_test_artifacts",
			"0003_run_retention",
			"0004_stray_output",
			"0005_scrub_ci_env_vars",
			"0006_test_attempts",
		]);
	});

	it("creates test_attempts and a nullable test_errors.attempt_id on a fresh database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0006-fresh-"));
		try {
			const result = await Effect.runPromise(
				Effect.provide(shape, migrateWithFile(join(dir, "data.db"), PROJECT_MIGRATIONS as never)),
			);
			expect(result.attempts).toEqual(ATTEMPT_COLUMNS);
			expect(result.attemptId).toEqual([{ name: "attempt_id", notnull: 0 }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("widens a 0005 database in place, keeping existing errors with a NULL attempt_id", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0006-"));
		const file = join(dir, "data.db");
		try {
			await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h', '5')`;
						yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('i', 'p', 'h', '2026-01-01T00:00:00.000Z', 'failed', 1, 1, 0, 1, 0)`;
						yield* sql`INSERT INTO test_errors (run_id, scope, message) VALUES (1, 'unhandled', 'boom')`;
					}),
					migrateWithFile(file, upTo0005),
				),
			);
			const after = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const rows = yield* sql<{
							message: string;
							attempt_id: number | null;
						}>`SELECT message, attempt_id FROM test_errors`;
						const fkCheck = yield* sql<{ table: string }>`PRAGMA foreign_key_check`;
						return { rows, fkCheck, shape: yield* shape };
					}),
					migrateWithFile(file, PROJECT_MIGRATIONS as never),
				),
			);
			expect(after.rows).toEqual([{ message: "boom", attempt_id: null }]);
			expect(after.fkCheck).toEqual([]);
			expect(after.shape.attempts).toEqual(ATTEMPT_COLUMNS);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
