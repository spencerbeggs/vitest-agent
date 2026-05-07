import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import migration0001 from "../src/migrations/0001_initial.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeContext.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) => Effect.runPromise(Effect.provide(effect, TestLayer));

describe("0001_initial migration", () => {
	it("creates all expected tables", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sql_%'
          ORDER BY name
        `;
				return rows.map((r) => r.name);
			}),
		);

		expect(tables).toContain("files");
		expect(tables).toContain("settings");
		expect(tables).toContain("settings_env_vars");
		expect(tables).toContain("test_runs");
		expect(tables).toContain("test_modules");
		expect(tables).toContain("test_suites");
		expect(tables).toContain("test_cases");
		expect(tables).toContain("test_errors");
		expect(tables).toContain("stack_frames");
		expect(tables).toContain("tags");
		expect(tables).toContain("test_case_tags");
		expect(tables).toContain("test_suite_tags");
		expect(tables).toContain("test_annotations");
		expect(tables).toContain("test_artifacts");
		expect(tables).toContain("attachments");
		expect(tables).toContain("import_durations");
		expect(tables).toContain("scoped_files");
		expect(tables).toContain("task_metadata");
		expect(tables).toContain("console_logs");
		expect(tables).toContain("test_history");
		expect(tables).toContain("coverage_baselines");
		expect(tables).toContain("coverage_trends");
		expect(tables).toContain("file_coverage");
		expect(tables).toContain("source_test_map");
		expect(tables).toContain("notes");
	});

	it("enforces foreign keys", async () => {
		const fkEnabled = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
				return rows[0]?.foreign_keys;
			}),
		);
		expect(fkEnabled).toBe(1);
	});

	it("uses WAL journal mode", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`PRAGMA journal_mode`;
				}),
			),
		).resolves.not.toThrow();
	});
});
