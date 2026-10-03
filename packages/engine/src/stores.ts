/*
 * The `@effected/store` side of the three SQLite databases: the keyed store
 * tags for the two auxiliary databases (their Live layers read the bare
 * `SqlClient` through `Store.sqlClient`), the ledger options every store
 * shares, and the conversion from the effect/sql migration records every
 * database declares to the `StoreMigration` list `Store` runs.
 *
 * Every store opens with {@link LEDGER_OPTIONS}: `adoptMigratorLedger`, so a
 * database that a 2.x `SqliteMigrator` already migrated keeps its history
 * (the effect/sql `effect_sql_migrations` rows are copied into
 * `_store_migrations` once, on the first open, and nothing re-runs), and
 * `mirrorMigratorLedger`, so `effect_sql_migrations` stays current. The mirror
 * is what lets an older vitest-agent open a file this version created or
 * migrated: `registry.db` is shared by every install on the machine, and
 * `sessions.db` / `data.db` by every version a host or project runs.
 */

import type { StoreMigration, StoreShape } from "@effected/store";
import { Context, Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/**
 * A migration set in the effect/sql record shape: `"<id>_<name>"` →
 * migration. The keys are the ones a 2.x `SqliteMigrator.fromRecord` recorded
 * in `effect_sql_migrations`, which is what ledger adoption matches against.
 * @public
 */
export type MigrationRecord = Record<string, Effect.Effect<void, SqlError, SqlClient>>;

/**
 * The ledger options every store opens with: adopt a 2.x effect/sql ledger
 * once, and keep mirroring into it so older versions still read it.
 *
 * @internal
 */
export const LEDGER_OPTIONS = { adoptMigratorLedger: true, mirrorMigratorLedger: true } as const;

/**
 * Convert a {@link MigrationRecord} to the `StoreMigration` list `Store` runs,
 * parsing each key exactly as effect/sql's `Migrator.fromRecord` does
 * (`/^(\d+)_(.+)$/`: `"0001_initial"` → id `1`, name `"initial"`), so the ids
 * and names line up with an adopted `effect_sql_migrations` ledger. A key that
 * does not match is skipped, as effect/sql skips it.
 *
 * @internal
 */
export const toStoreMigrations = (migrations: MigrationRecord): ReadonlyArray<StoreMigration> =>
	Object.entries(migrations)
		.flatMap(([key, migration]): ReadonlyArray<StoreMigration> => {
			const match = key.match(/^(\d+)_(.+)$/);
			if (match === null) return [];
			const [, id, name] = match as unknown as readonly [string, string, string];
			return [{ id: Number(id), name, up: (sql) => Effect.provideService(migration, SqlClient, sql) }];
		})
		.sort((a, b) => a.id - b.id);

/**
 * The global discovery registry (`<XDG data>/vitest-agent/registry.db`).
 * @internal
 */
export class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("vitest-agent/RegistryStore") {}

/**
 * The per-client session map (`sessions.db`, under the host's plugin data dir).
 * @internal
 */
export class SessionMapStore extends Context.Service<SessionMapStore, StoreShape>()("vitest-agent/SessionMapStore") {}
