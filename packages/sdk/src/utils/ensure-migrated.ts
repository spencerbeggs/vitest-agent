/**
 * Process-level migration coordination.
 *
 * In multi-project Vitest configurations, a single Vitest process creates
 * multiple AgentReporter instances (one per project) that all share the
 * same SQLite database file. When run with a fresh database, each reporter
 * tries to apply migrations through its own SqliteClient connection. Two
 * connections both starting deferred transactions and then upgrading to
 * write produces SQLITE_BUSY (database is locked), and the SQLite busy
 * handler is not invoked for write-write upgrade conflicts in deferred
 * transactions.
 *
 * The fix is to serialize migration in the parent process: ensure the
 * database is migrated exactly once per dbPath before any reporter tries
 * to read or write. After migration completes, concurrent reads and
 * writes from separate connections work normally under WAL mode plus
 * better-sqlite3's 5s busy_timeout.
 *
 * The promise cache lives on `globalThis` because Vite's multi-project
 * pipeline can load this module under separate module instances even in
 * the same process; using a module-local Map results in independent
 * caches per project, which defeats the coordination.
 *
 * @packageDocumentation
 */

import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { LogLevel } from "effect";
import { Effect, Layer } from "effect";
import { LoggerLive } from "../layers/LoggerLive.js";
import migration0001 from "../migrations/0001_initial.js";
import migration0002 from "../migrations/0002_comprehensive.js";

const GLOBAL_KEY = Symbol.for("vitest-agent/migration-promises");

type MigrationCache = Map<string, Promise<void>>;

const getCache = (): MigrationCache => {
	const g = globalThis as { [GLOBAL_KEY]?: MigrationCache };
	let cache = g[GLOBAL_KEY];
	if (!cache) {
		cache = new Map();
		g[GLOBAL_KEY] = cache;
	}
	return cache;
};

/**
 * Ensure the SQLite database at `dbPath` is migrated. Runs migrations at
 * most once per dbPath in the current process; concurrent calls share the
 * same in-flight promise. Subsequent calls (after the first resolves) are
 * no-ops.
 */
export function ensureMigrated(dbPath: string, logLevel?: LogLevel.LogLevel, logFile?: string): Promise<void> {
	const cache = getCache();
	const cached = cache.get(dbPath);
	if (cached) return cached;

	const SqliteLayer = sqliteClientLayer({ filename: dbPath });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
			"0002_comprehensive": migration0002,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	// MigratorLayer is `Layer.effectDiscard(...)` — it provides nothing but
	// runs migrations as a side effect of layer acquisition. Effect's runtime
	// instantiates every provided layer when the scope opens, so the migrator
	// fires even though no `yield*` consumes a service from it.
	//
	// `yield* SqlClient` exists to force the outer `SqliteLayer` to build for
	// this scope; that's where WAL mode is set on the connection that this
	// program holds open while it waits for migrations to complete.
	const program = Effect.gen(function* () {
		yield* SqlClient;
	}).pipe(
		Effect.provide(MigratorLayer),
		Effect.provide(Layer.merge(SqliteLayer, PlatformLayer)),
		Effect.provide(LoggerLive(logLevel, logFile)),
	);

	const promise = Effect.runPromise(program);
	cache.set(dbPath, promise);
	// Suppress unhandledRejection on the cached reference; callers await the
	// returned promise and handle rejection themselves.
	promise.catch(() => {});
	return promise;
}

/**
 * Reset the migration cache. Test-only.
 *
 * @internal
 */
export function _resetMigrationCacheForTesting(): void {
	getCache().clear();
}
