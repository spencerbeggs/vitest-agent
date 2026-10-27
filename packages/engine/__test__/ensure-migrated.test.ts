import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { ensureMigrated } from "../src/utils/ensure-migrated.js";

const newDbPath = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "ensure-migrated-test-"));
	return join(dir, "data.db");
};

describe("ensureMigrated", () => {
	it("creates and migrates a fresh database", async () => {
		const dbPath = newDbPath();
		await expect(ensureMigrated(dbPath)).resolves.toBeUndefined();
	});

	it("does not remember a failed run: a later call retries and succeeds", async () => {
		const dir = join(mkdtempSync(join(tmpdir(), "ensure-migrated-test-")), "not-yet");
		const dbPath = join(dir, "data.db");
		// The parent directory is missing, so the first run fails.
		await expect(ensureMigrated(dbPath)).rejects.toBeDefined();
		mkdirSync(dir);
		await expect(ensureMigrated(dbPath)).resolves.toBeUndefined();
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
			}).pipe(Effect.provide(sqliteClientLayer({ filename: dbPath })), Effect.provide(NodeServices.layer)),
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
			}).pipe(Effect.provide(sqliteClientLayer({ filename: dbPath })), Effect.provide(NodeServices.layer)),
		);
		expect(tables).toBe(1);
	});
});
