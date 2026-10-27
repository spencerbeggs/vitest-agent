/*
 * The `@effected/store` side of the three SQLite databases: the keyed store
 * tags for the two auxiliary databases (their Live layers read the bare
 * `SqlClient` through `Store.sqlClient`), the ledger options every store
 * shares, and the per-connection options. The effect/sql migration records
 * every database declares become `Store`'s list through
 * `Store.fromMigratorRecord`, which parses keys as effect/sql does.
 *
 * Every store opens with {@link LEDGER_OPTIONS}: `adoptMigratorLedger`, so a
 * database that a 2.x `SqliteMigrator` already migrated keeps its history
 * (the effect/sql `effect_sql_migrations` rows are copied into
 * `_store_migrations` once, on the first open, and nothing re-runs). The
 * ledger is not mirrored back: an older vitest-agent opening a file this
 * version created is not supported.
 */

import type { StoreShape } from "@effected/store";
import type { Duration, Effect } from "effect";
import { Context } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
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
 * once, on the first open.
 *
 * @internal
 */
export const LEDGER_OPTIONS = { adoptMigratorLedger: true } as const;

/**
 * How long a connection waits on a locked database before `SQLITE_BUSY`:
 * five seconds, the value the 2.x migrations set with `PRAGMA busy_timeout`.
 * Passed as the driver's `busyTimeout`, which applies it on every open.
 *
 * @internal
 */
export const BUSY_TIMEOUT: Duration.Input = "5 seconds";

/**
 * The per-connection settings every database applies as its connection
 * opens, before any migration: foreign-key enforcement on. The 2.x
 * migrations set `foreign_keys` / `busy_timeout` themselves, which a
 * migration can only do for the one connection that runs it; the
 * `node:sqlite` driver happens to default both today, and this pins them
 * so a driver default change cannot silently drop them.
 *
 * @internal
 */
export const applyConnectionPragmas = (sql: SqlClient): Effect.Effect<unknown, SqlError> =>
	sql`PRAGMA foreign_keys = ON`;

/**
 * The connection options every keyed store opens with: the driver's
 * `busyTimeout` and {@link applyConnectionPragmas} as `onConnect`.
 *
 * @internal
 */
export const CONNECTION_OPTIONS = {
	client: { busyTimeout: BUSY_TIMEOUT },
	onConnect: applyConnectionPragmas,
} as const;

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
