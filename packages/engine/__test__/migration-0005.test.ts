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

const upTo0004: Record = {
	"0001_initial": migration0001,
	"0002_test_artifacts": migration0002,
	"0003_run_retention": migration0003,
	"0004_stray_output": migration0004,
};

// What the pre-0005 prefix sweep stored under GitHub Actions: the kept run
// coordinates, secrets and other prefixed variables, plus non-CI keys.
const SEEDED: ReadonlyArray<readonly [string, string]> = [
	["CI", "true"],
	["NODE_ENV", "test"],
	["GITHUB_ACTIONS", "true"],
	["GITHUB_SHA", "abc"],
	["GITHUB_REF_NAME", "main"],
	["RUNNER_OS", "Linux"],
	["GITHUB_TOKEN", "ghs_secret"],
	["GITHUB_DEPLOY_KEY", "secret"],
	["RUNNER_TEMP", "/tmp/runner"],
	// `_` is a LIKE wildcard: an unescaped pattern would delete these too.
	["GITHUBX", "kept"],
	["RUNNERX", "kept"],
];

describe("0005_scrub_ci_env_vars", () => {
	it("is registered in PROJECT_MIGRATIONS after 0004", () => {
		expect(Object.keys(PROJECT_MIGRATIONS).slice(0, 5)).toEqual([
			"0001_initial",
			"0002_test_artifacts",
			"0003_run_retention",
			"0004_stray_output",
			"0005_scrub_ci_env_vars",
		]);
	});

	it("deletes every GITHUB_* / RUNNER_* row outside the kept run coordinates", async () => {
		const dir = mkdtempSync(join(tmpdir(), "vitest-agent-0005-"));
		const file = join(dir, "data.db");
		try {
			await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h', '5')`;
						for (const [key, value] of SEEDED) {
							yield* sql`INSERT INTO settings_env_vars (settings_hash, key, value) VALUES ('h', ${key}, ${value})`;
						}
					}),
					migrateWithFile(file, upTo0004),
				),
			);

			const keys = await Effect.runPromise(
				Effect.provide(
					Effect.gen(function* () {
						const sql = yield* SqlClient;
						const rows = yield* sql<{ key: string }>`SELECT key FROM settings_env_vars ORDER BY key`;
						return rows.map((r) => r.key);
					}),
					migrateWithFile(file, PROJECT_MIGRATIONS as never),
				),
			);
			expect(keys).toEqual([
				"CI",
				"GITHUBX",
				"GITHUB_ACTIONS",
				"GITHUB_REF_NAME",
				"GITHUB_SHA",
				"NODE_ENV",
				"RUNNERX",
				"RUNNER_OS",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
