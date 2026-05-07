import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { _resetMigrationCacheForTesting, ensureMigrated } from "../src/utils/ensure-migrated.js";

const newDbPath = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "ensure-migrated-test-"));
	return join(dir, "data.db");
};

describe("ensureMigrated", () => {
	afterEach(() => {
		_resetMigrationCacheForTesting();
	});

	it("creates and migrates a fresh database", async () => {
		const dbPath = newDbPath();
		await expect(ensureMigrated(dbPath)).resolves.toBeUndefined();
	});

	it("returns the same promise for concurrent calls with the same dbPath", () => {
		const dbPath = newDbPath();
		const a = ensureMigrated(dbPath);
		const b = ensureMigrated(dbPath);
		expect(a).toBe(b);
	});

	it("returns independent promises for different dbPaths", () => {
		const a = ensureMigrated(newDbPath());
		const b = ensureMigrated(newDbPath());
		expect(a).not.toBe(b);
	});

	it("serializes migration so concurrent callers do not race on a fresh database", async () => {
		const dbPath = newDbPath();
		const promises = [ensureMigrated(dbPath), ensureMigrated(dbPath), ensureMigrated(dbPath)];
		// All resolve without "database is locked".
		await expect(Promise.all(promises)).resolves.toBeDefined();
	});

	it("creates the 2.0 schema (sessions table) in a fresh DB", async () => {
		const dbPath = newDbPath();
		await ensureMigrated(dbPath);

		const tables = await Effect.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{
					name: string;
				}>`SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`;
				return rows.length;
			}).pipe(Effect.provide(sqliteClientLayer({ filename: dbPath })), Effect.provide(NodeContext.layer)),
		);
		expect(tables).toBe(1);
	});

	it("migration 0003 creates the mcp_idempotent_responses table", async () => {
		const dbPath = newDbPath();
		await ensureMigrated(dbPath);

		const tables = await Effect.runPromise(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{
					name: string;
				}>`SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_idempotent_responses'`;
				return rows.length;
			}).pipe(Effect.provide(sqliteClientLayer({ filename: dbPath })), Effect.provide(NodeContext.layer)),
		);
		expect(tables).toBe(1);
	});
});
