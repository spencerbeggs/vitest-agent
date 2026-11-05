import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@effected/store";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSqliteStack } from "../src/platform.js";
import { RegistryStoreLive, SessionMapStoreLive } from "../src/programs/platform-sidecar.js";
import { RegistryStore, SessionMapStore } from "../src/stores.js";
import { ensureMigrated } from "../src/utils/ensure-migrated.js";

const readPragmas = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
	const bt = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
	return { foreignKeys: fk[0]?.foreign_keys, busyTimeout: bt[0]?.timeout };
});

/** Every setting a `data.db` connection is opened with, including the two the driver and the engine split between them. */
const readAllPragmas = (sql: SqlClient) =>
	Effect.gen(function* () {
		const journal = yield* sql<{ journal_mode: string }>`PRAGMA journal_mode`;
		const synchronous = yield* sql<{ synchronous: number }>`PRAGMA synchronous`;
		const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
		const bt = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
		return {
			journalMode: journal[0]?.journal_mode,
			synchronous: synchronous[0]?.synchronous,
			foreignKeys: fk[0]?.foreign_keys,
			busyTimeout: bt[0]?.timeout,
		};
	});

/** SQLite's `PRAGMA synchronous` values: the driver default is FULL, `data.db` lowers it to NORMAL. */
const SYNCHRONOUS_NORMAL = 1;
const SYNCHRONOUS_FULL = 2;

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "va-pragmas-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

/** Open the layer twice: the first build migrates, the second is a fresh connection with nothing left to migrate. */
const secondConnection = <E>(layer: Layer.Layer<SqlClient, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.scoped(Layer.build(layer));
			return yield* readPragmas.pipe(Effect.provide(layer));
		}),
	);

// The 2.x migrations set foreign_keys / busy_timeout, which only reaches the
// one connection that runs them. On the installed driver both happen to
// default on every open (node:sqlite enables foreign keys; sql-sqlite-node
// sets busy_timeout 5000), so these pin the engine's explicit per-connection
// settings against a driver default change.
describe("per-connection pragmas", () => {
	it("data.db: a fresh connection after migration has foreign_keys on and busy_timeout 5000", async () => {
		const { SqliteLayer, MigratorLayer } = makeSqliteStack(join(dir, "data.db"));
		expect(await secondConnection(Layer.merge(SqliteLayer, MigratorLayer.pipe(Layer.provide(SqliteLayer))))).toEqual({
			foreignKeys: 1,
			busyTimeout: 5000,
		});
	});

	it("sessions.db: a fresh connection after migration has foreign_keys on and busy_timeout 5000", async () => {
		const layer = Store.sqlClient(SessionMapStore).pipe(Layer.provide(SessionMapStoreLive(join(dir, "sessions.db"))));
		expect(await secondConnection(layer)).toEqual({ foreignKeys: 1, busyTimeout: 5000 });
	});

	it("registry.db: a fresh connection after migration has foreign_keys on and busy_timeout 5000", async () => {
		const layer = Store.sqlClient(RegistryStore).pipe(Layer.provide(RegistryStoreLive(join(dir, "registry.db"))));
		expect(await secondConnection(layer)).toEqual({ foreignKeys: 1, busyTimeout: 5000 });
	});

	it("data.db via makeSqliteStack: a fresh connection after migration has WAL and synchronous NORMAL", async () => {
		const { SqliteLayer, MigratorLayer } = makeSqliteStack(join(dir, "data.db"));
		const layer = Layer.merge(SqliteLayer, MigratorLayer.pipe(Layer.provide(SqliteLayer)));
		const pragmas = await Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.scoped(Layer.build(layer));
				return yield* Effect.flatMap(SqlClient, readAllPragmas).pipe(Effect.provide(layer));
			}),
		);
		expect(pragmas).toEqual({
			journalMode: "wal",
			synchronous: SYNCHRONOUS_NORMAL,
			foreignKeys: 1,
			busyTimeout: 5000,
		});
	});

	it("data.db via ensureMigrated: the connection that migrates has WAL and synchronous NORMAL", async () => {
		// The connection closes when ensureMigrated returns and synchronous is
		// per-connection, so read it from inside: the real migrateOnce runs against
		// the real file, with a read appended to whatever onConnect ensureMigrated
		// passed. A missing onConnect leaves the driver defaults and fails the assertion.
		const seen: Array<Effect.Success<ReturnType<typeof readAllPragmas>>> = [];
		const migrateOnce = Store.migrateOnce.bind(Store);
		vi.spyOn(Store, "migrateOnce").mockImplementation((options) =>
			migrateOnce({
				...options,
				onConnect: (sql) =>
					(options.onConnect?.(sql) ?? Effect.void).pipe(
						Effect.andThen(readAllPragmas(sql)),
						Effect.tap((pragmas) => Effect.sync(() => seen.push(pragmas))),
					),
			}),
		);
		await ensureMigrated(join(dir, "data.db"));
		expect(seen).toEqual([{ journalMode: "wal", synchronous: SYNCHRONOUS_NORMAL, foreignKeys: 1, busyTimeout: 5000 }]);
	});

	it("sessions.db and registry.db keep the driver's synchronous FULL: NORMAL is data.db's alone", async () => {
		const sessions = Store.sqlClient(SessionMapStore).pipe(
			Layer.provide(SessionMapStoreLive(join(dir, "sessions.db"))),
		);
		const registry = Store.sqlClient(RegistryStore).pipe(Layer.provide(RegistryStoreLive(join(dir, "registry.db"))));
		for (const layer of [sessions, registry]) {
			const pragmas = await Effect.runPromise(Effect.flatMap(SqlClient, readAllPragmas).pipe(Effect.provide(layer)));
			expect(pragmas).toEqual({
				journalMode: "wal",
				synchronous: SYNCHRONOUS_FULL,
				foreignKeys: 1,
				busyTimeout: 5000,
			});
		}
	});
});
