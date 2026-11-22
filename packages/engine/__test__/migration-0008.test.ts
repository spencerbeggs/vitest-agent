import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { PROJECT_MIGRATIONS } from "../src/migrations/index.js";

const MODULE_CACHE_COLUMNS = [
	"module_cache_enabled",
	"module_cache_transform_ms",
	"module_cache_tracked_ms",
	"module_cache_modules_written",
];

const migrateWithFile = (filename: string) => {
	const SqliteLayer = sqliteClientLayer({ filename });
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(PROJECT_MIGRATIONS as never),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);
};

const columnInfo = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const columns = yield* sql<{ name: string; type: string; notnull: number }>`
		SELECT name, type, "notnull" FROM pragma_table_info('test_runs')`;
	return columns.filter((c) => MODULE_CACHE_COLUMNS.includes(c.name));
});

describe("0008_module_cache", () => {
	it("is registered in PROJECT_MIGRATIONS after 0007", () => {
		expect(Object.keys(PROJECT_MIGRATIONS).slice(6)).toEqual(["0007_trace_steps", "0008_module_cache"]);
	});

	it("adds the four nullable module_cache_* columns to test_runs", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0008-"));
		try {
			const columns = await Effect.runPromise(Effect.provide(columnInfo, migrateWithFile(join(dir, "data.db"))));
			expect(columns.map((c) => c.name)).toEqual(MODULE_CACHE_COLUMNS);
			expect(columns.map((c) => c.type)).toEqual(["INTEGER", "REAL", "REAL", "INTEGER"]);
			expect(columns.every((c) => c.notnull === 0)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
