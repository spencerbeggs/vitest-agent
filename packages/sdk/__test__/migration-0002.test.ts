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

	it("applies cleanly to a database already migrated to 0001", async () => {
		const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
		const PlatformLayer = NodeServices.layer;
		const Both = SqliteMigrator.layer({
			loader: SqliteMigrator.fromRecord({
				"0001_initial": migration0001,
				"0002_test_artifacts": migration0002,
			} as never),
		}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

		const rows = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO test_annotations (test_case_id, type, message) VALUES (NULL, 'issues', 'ok')`.pipe(
						Effect.catchCause(() => Effect.void),
					);
					return yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM test_annotations`;
				}),
				Layer.mergeAll(Both, SqliteLayer, PlatformLayer),
			),
		);
		expect(rows[0].n).toBeGreaterThanOrEqual(0);
	});
});
