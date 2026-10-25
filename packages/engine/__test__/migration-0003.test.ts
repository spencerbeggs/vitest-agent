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

const upTo0002: Record = { "0001_initial": migration0001, "0002_test_artifacts": migration0002 };
const upTo0003: Record = { ...upTo0002, "0003_run_retention": migration0003 };

interface ForeignKey {
	readonly table: string;
	readonly from: string;
	readonly on_delete: string;
}

describe("0003_run_retention", () => {
	it("is registered in PROJECT_MIGRATIONS after 0002", () => {
		expect(Object.keys(PROJECT_MIGRATIONS)).toEqual(["0001_initial", "0002_test_artifacts", "0003_run_retention"]);
	});

	it("rebuilds test_history so run_id is nullable and SET NULL on run deletion, keeping every row", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0003-"));
		const file = join(dir, "data.db");
		try {
			// A 0002-shaped database with a run and one history row.
			await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h', '5')`;
						yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('i', 'p', 'h', '2026-01-01T00:00:00.000Z', 'passed', 1, 1, 1, 0, 0)`;
						yield* sql`INSERT INTO test_history (run_id, project, module_path, full_name, timestamp, state, flaky, retry_count, error_message) VALUES (1, 'p', 'm.test.ts', 't', '2026-01-01T00:00:00.000Z', 'failed', 0, 0, 'boom')`;
					}),
					migrateWithFile(file, upTo0002),
				),
			);

			const result = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const columns = yield* sql<{ name: string; notnull: number }>`
							SELECT name, "notnull" FROM pragma_table_info('test_history')`;
						const fks =
							yield* sql<ForeignKey>`SELECT "table", "from", on_delete FROM pragma_foreign_key_list('test_history')`;
						const rows = yield* sql<{
							run_id: number | null;
							error_message: string | null;
						}>`SELECT run_id, error_message FROM test_history`;
						const indexes = yield* sql<{ name: string }>`
							SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'test_history' AND name LIKE 'idx_%' ORDER BY name`;
						yield* sql`DELETE FROM test_runs`;
						const afterDelete = yield* sql<{ run_id: number | null }>`SELECT run_id FROM test_history`;
						const fkCheck = yield* sql<{ table: string }>`PRAGMA foreign_key_check`;
						return { columns, fks, rows, indexes: indexes.map((i) => i.name), afterDelete, fkCheck };
					}),
					migrateWithFile(file, upTo0003),
				),
			);

			expect(result.columns.map((c) => c.name)).toEqual([
				"id",
				"run_id",
				"project",
				"module_path",
				"full_name",
				"timestamp",
				"state",
				"duration",
				"flaky",
				"retry_count",
				"error_message",
			]);
			expect(result.columns.find((c) => c.name === "run_id")?.notnull).toBe(0);
			expect(result.fks).toEqual([{ table: "test_runs", from: "run_id", on_delete: "SET NULL" }]);
			expect(result.rows).toEqual([{ run_id: 1, error_message: "boom" }]);
			expect(result.indexes).toEqual(["idx_test_history_full_name", "idx_test_history_lookup", "idx_test_history_run"]);
			expect(result.afterDelete).toEqual([{ run_id: null }]);
			expect(result.fkCheck).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("indexes every child foreign key a run prune cascades through", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0003-idx-"));
		try {
			const names = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const rows = yield* sql<{
							name: string;
						}>`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`;
						return new Set(rows.map((r) => r.name));
					}),
					migrateWithFile(join(dir, "data.db"), upTo0003),
				),
			);
			for (const expected of [
				"idx_test_runs_project_timestamp",
				"idx_test_modules_file",
				"idx_scoped_files_file",
				"idx_stack_frames_file",
				"idx_test_annotations_file",
				"idx_test_artifacts_file",
				"idx_import_durations_file",
				"idx_tdd_artifacts_file",
				"idx_tdd_artifacts_test_case",
				"idx_tdd_artifacts_test_run",
				"idx_tdd_artifacts_first_failure_run",
				"idx_failure_signatures_first_seen_run",
				"idx_test_errors_suite",
				"idx_test_errors_module",
				"idx_test_errors_cause",
				"idx_test_suites_parent",
				"idx_task_metadata_case",
				"idx_task_metadata_suite",
				"idx_task_metadata_module",
				"idx_hook_executions_module",
				"idx_hook_executions_suite",
				"idx_hook_executions_case",
				"idx_hook_executions_error",
				"idx_attachments_artifact",
				"idx_attachments_annotation",
				"idx_hypotheses_cited_error",
				"idx_hypotheses_cited_frame",
			]) {
				expect(names.has(expected), expected).toBe(true);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
