import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import migration0001 from "../src/migrations/0001_initial.js";
import migration0002 from "../src/migrations/0002_test_artifacts.js";

interface ColumnInfo {
	readonly name: string;
	readonly type: string;
	readonly notnull: number;
}

const migrateWith = (record: Record<string, Effect.Effect<void, unknown, SqlClient>>) => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(record as never),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);
};

const migrateWithFile = (filename: string, record: Record<string, Effect.Effect<void, unknown, SqlClient>>) => {
	const SqliteLayer = sqliteClientLayer({ filename });
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(record as never),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);
};

const columns = (table: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		return yield* sql<ColumnInfo>`SELECT name, type, "notnull" FROM pragma_table_info(${table})`;
	});

describe("0002_test_artifacts", () => {
	it("reshapes test_annotations, test_artifacts and attachments on a fresh database", async () => {
		const layer = migrateWith({ "0001_initial": migration0001, "0002_test_artifacts": migration0002 });
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					const annotations = yield* columns("test_annotations");
					const artifacts = yield* columns("test_artifacts");
					const attachments = yield* columns("attachments");
					const ddl = yield* sql<{
						sql: string;
					}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_annotations'`;
					const indexes = yield* sql<{
						name: string;
					}>`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'test_annotations'`;
					return { annotations, artifacts, attachments, ddl: ddl[0].sql, indexes: indexes.map((i) => i.name) };
				}),
				layer,
			),
		);

		const annotationNames = result.annotations.map((c) => c.name);
		expect(annotationNames).toEqual([
			"id",
			"test_case_id",
			"type",
			"message",
			"location_file_id",
			"location_line",
			"location_column",
		]);
		expect(annotationNames).not.toContain("attachment_path");
		expect(result.ddl).not.toContain("CHECK");

		expect(result.artifacts.map((c) => c.name)).toContain("data");
		expect(result.attachments.map((c) => c.name)).toContain("byte_size");

		expect(result.indexes).toContain("idx_test_annotations_case");
		expect(result.indexes).toContain("idx_test_annotations_type");
	});

	it("applies 0002 over a database that already ran only 0001", async () => {
		const dir = mkdtempSync(join(tmpdir(), "va-0002-"));
		const filename = join(dir, "data.db");
		try {
			// Pass 1: a database that only ever saw 0001 -- the pre-2.0 shape
			// every installed consumer carries on disk.
			const first = migrateWithFile(filename, { "0001_initial": migration0001 });
			const before = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const ddl = yield* sql<{
							sql: string;
						}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_annotations'`;
						return { annotations: yield* columns("test_annotations"), ddl: ddl[0].sql };
					}),
					first,
				),
			);
			expect(before.ddl).toContain("CHECK");
			expect(before.annotations.map((c) => c.name)).toContain("attachment_path");

			// Pass 2: a fresh migrator over the SAME file with both
			// migrations. Only 0002 should run.
			const second = migrateWithFile(filename, {
				"0001_initial": migration0001,
				"0002_test_artifacts": migration0002,
			});
			const after = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const ddl = yield* sql<{
							sql: string;
						}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_annotations'`;
						const applied = yield* sql<{
							name: string;
						}>`SELECT name FROM effect_sql_migrations ORDER BY migration_id`;
						return {
							annotations: yield* columns("test_annotations"),
							artifacts: yield* columns("test_artifacts"),
							attachments: yield* columns("attachments"),
							ddl: ddl[0].sql,
							applied: applied.map((m) => m.name),
						};
					}),
					second,
				),
			);

			// Two recorded rows, inserted one pass each: 0001 was NOT re-run
			// (its migration_id is a primary key, so a re-run would conflict).
			// The migrator strips the numeric prefix from the recorded name.
			expect(after.applied).toEqual(["initial", "test_artifacts"]);
			expect(after.ddl).not.toContain("CHECK");
			expect(after.annotations.map((c) => c.name)).toEqual([
				"id",
				"test_case_id",
				"type",
				"message",
				"location_file_id",
				"location_line",
				"location_column",
			]);
			expect(after.artifacts.map((c) => c.name)).toEqual([
				"id",
				"test_case_id",
				"type",
				"message",
				"location_file_id",
				"location_line",
				"location_column",
				"data",
			]);
			expect(after.attachments.map((c) => c.name)).toEqual([
				"id",
				"artifact_id",
				"annotation_id",
				"content_type",
				"path",
				"body",
				"byte_size",
				"body_encoding",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
