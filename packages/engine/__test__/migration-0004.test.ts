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

const upTo0003: Record = {
	"0001_initial": migration0001,
	"0002_test_artifacts": migration0002,
	"0003_run_retention": migration0003,
};
const upTo0004: Record = { ...upTo0003, "0004_stray_output": migration0004 };

const STRAY_COLUMNS = ["stray_total", "stray_stdout", "stray_stderr", "stray_bytes", "stray_samples"];

const strayColumnInfo = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const columns = yield* sql<{ name: string; type: string; notnull: number }>`
		SELECT name, type, "notnull" FROM pragma_table_info('test_runs')`;
	return columns.filter((c) => STRAY_COLUMNS.includes(c.name));
});

describe("0004_stray_output", () => {
	it("is registered in PROJECT_MIGRATIONS after 0003", () => {
		expect(Object.keys(PROJECT_MIGRATIONS)).toEqual([
			"0001_initial",
			"0002_test_artifacts",
			"0003_run_retention",
			"0004_stray_output",
		]);
	});

	it("adds the five nullable stray_* columns to test_runs on a fresh database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0004-fresh-"));
		try {
			const columns = await Effect.runPromise(
				Effect.provide(strayColumnInfo, migrateWithFile(join(dir, "data.db"), PROJECT_MIGRATIONS as never)),
			);
			expect(columns.map((c) => c.name)).toEqual(STRAY_COLUMNS);
			expect(columns.map((c) => c.type)).toEqual(["INTEGER", "INTEGER", "INTEGER", "INTEGER", "TEXT"]);
			expect(columns.every((c) => c.notnull === 0)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("widens a 0003 database in place, keeping its runs with NULL stray output", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0004-"));
		const file = join(dir, "data.db");
		try {
			// A 0003-shaped database with one run — the pre-0004 schema has no stray columns.
			const before = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h', '5')`;
						yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('i', 'p', 'h', '2026-01-01T00:00:00.000Z', 'passed', 1, 1, 1, 0, 0)`;
						return yield* strayColumnInfo;
					}),
					migrateWithFile(file, upTo0003),
				),
			);
			expect(before).toEqual([]);

			const after = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const columns = yield* strayColumnInfo;
						const rows = yield* sql<{
							project: string;
							stray_total: number | null;
							stray_samples: string | null;
						}>`SELECT project, stray_total, stray_samples FROM test_runs`;
						const fkCheck = yield* sql<{ table: string }>`PRAGMA foreign_key_check`;
						return { columns: columns.map((c) => c.name), rows, fkCheck };
					}),
					migrateWithFile(file, upTo0004),
				),
			);
			expect(after.columns).toEqual(STRAY_COLUMNS);
			expect(after.rows).toEqual([{ project: "p", stray_total: null, stray_samples: null }]);
			expect(after.fkCheck).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
