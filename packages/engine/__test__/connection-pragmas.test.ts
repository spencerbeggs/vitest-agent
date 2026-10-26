import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@effected/store";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSqliteStack } from "../src/platform.js";
import { RegistryStoreLive, SessionMapStoreLive } from "../src/programs/platform-sidecar.js";
import { RegistryStore, SessionMapStore } from "../src/stores.js";

const readPragmas = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
	const bt = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
	return { foreignKeys: fk[0]?.foreign_keys, busyTimeout: bt[0]?.timeout };
});

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "va-pragmas-"));
});
afterEach(() => {
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
});
