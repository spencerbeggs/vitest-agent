import { Store } from "@effected/store";
import type { LogLevel } from "effect";
import { Effect } from "effect";
import { LoggerLive } from "../layers/LoggerLive.js";
import { PROJECT_MIGRATIONS } from "../migrations/index.js";
import { NodePlatformLayer } from "../platform.js";
import { BUSY_TIMEOUT, LEDGER_OPTIONS, applyConnectionPragmas } from "../stores.js";

/**
 * The project migrations as `Store` runs them, built once so every call
 * hands `Store.migrateOnce` the same list.
 */
const PROJECT_STORE_MIGRATIONS = Store.fromMigratorRecord(PROJECT_MIGRATIONS);

/**
 * Ensure the SQLite database at `dbPath` is migrated to the head of the
 * project migration set.
 *
 * Runs through `@effected/store`'s `Store.migrateOnce`: at most one
 * successful migration run per database per process, shared by every
 * concurrent caller (and by every copy of the kit loaded in the process).
 * The run is keyed on the real path of the file's directory, so a relative,
 * an absolute and a symlinked spelling of one database share it. A failed
 * run (for example `SQLITE_BUSY`) is not remembered: the next call tries
 * again. The connection opens with the same per-connection settings as
 * `makeSqliteStack` (`busy_timeout`, `synchronous = NORMAL`,
 * `foreign_keys = ON`).
 *
 * The parent directory must exist; `dbPath` must name a file (`":memory:"`
 * is a wiring defect).
 *
 * @param dbPath - the SQLite file to migrate
 * @param logLevel - the diagnostics level for the migrator's records; see `LoggerLive`
 * @param logFile - a file to append NDJSON diagnostics to; see `LoggerLive`
 * @param env - the environment map `LoggerLive` detects the runtime from, so
 *   records are neutralized under GitHub Actions (the front end passes `process.env`)
 * @public
 */
export function ensureMigrated(
	dbPath: string,
	logLevel?: LogLevel.LogLevel,
	logFile?: string,
	env?: Readonly<Record<string, string | undefined>>,
): Promise<void> {
	return Effect.runPromise(
		Store.migrateOnce({
			filename: dbPath,
			migrations: PROJECT_STORE_MIGRATIONS,
			...LEDGER_OPTIONS,
			client: { busyTimeout: BUSY_TIMEOUT },
			onConnect: (sql) => Effect.andThen(sql`PRAGMA synchronous = NORMAL`, applyConnectionPragmas(sql)),
		}).pipe(Effect.provide(NodePlatformLayer), Effect.provide(LoggerLive(logLevel, logFile, env))),
	);
}
