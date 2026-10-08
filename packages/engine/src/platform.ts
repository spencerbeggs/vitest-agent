import * as NodeServices from "@effect/platform-node/NodeServices";
import type { SqliteClient } from "@effect/sql-sqlite-node/SqliteClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import type { StoreError, StoreMigrationError } from "@effected/store";
import { Store } from "@effected/store";
import type { LogLevel } from "effect";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { DataReaderLive } from "./layers/DataReaderLive.js";
import { DataStoreLive } from "./layers/DataStoreLive.js";
import { HistoryTrackerLive } from "./layers/HistoryTrackerLive.js";
import { LoggerLive } from "./layers/LoggerLive.js";
import { OutputPipelineLive } from "./layers/OutputPipelineLive.js";
import { ProjectDiscoveryLive } from "./layers/ProjectDiscoveryLive.js";
import { PROJECT_MIGRATIONS } from "./migrations/index.js";
import type { DataReader } from "./services/DataReader.js";
import type { DataStore } from "./services/DataStore.js";
import type { DetailResolver } from "./services/DetailResolver.js";
import type { EnvironmentDetector } from "./services/EnvironmentDetector.js";
import type { ExecutorResolver } from "./services/ExecutorResolver.js";
import type { HistoryTracker } from "./services/HistoryTracker.js";
import type { ProjectDiscovery } from "./services/ProjectDiscovery.js";
import type { MigrationRecord } from "./stores.js";
import { LEDGER_OPTIONS, toStoreMigrations } from "./stores.js";

export type { MigrationRecord } from "./stores.js";

/**
 * A SQLite connection plus the migrator that brings it to the head of a
 * migration set. Returned by {@link makeSqliteStack}.
 * @public
 */
export interface SqliteStack {
	/** The `SqlClient` layer for `filename`; fails with `SqlError` when the file cannot be opened. */
	readonly SqliteLayer: Layer.Layer<SqliteClient | SqlClient, SqlError>;
	/**
	 * `Layer.effectDiscard`-shaped: provides nothing, runs the migrations as a
	 * side effect of layer acquisition. Already fed its `SqlClient`. Backed by
	 * `@effected/store`'s `Store.layer` with the engine's ledger options
	 * (adopt and mirror effect/sql's ledger), so a database a 2.x
	 * `SqliteMigrator` migrated keeps its history and a 2.x install can still
	 * open it.
	 */
	readonly MigratorLayer: Layer.Layer<never, PlatformLiveError>;
}

/**
 * The Node platform services every SQLite stack and every Live layer share.
 * `NodeServices.layer` aggregates FileSystem | Path | ChildProcessSpawner |
 * Crypto | Stdio | Terminal.
 * @public
 */
export const NodePlatformLayer = NodeServices.layer;

/**
 * Build one SQLite database stack: the client layer for `filename` and a
 * migrator over `migrations` that is already provided with that client and
 * the Node platform services. The single assembly the CLI, MCP server,
 * plugin, `ensureMigrated` and the testing layers all share.
 *
 * @param filename - SQLite file path, or `":memory:"`
 * @param migrations - the migration record to run; defaults to the project
 *   `data.db` set (`PROJECT_MIGRATIONS`)
 * @public
 */
export const makeSqliteStack = (filename: string, migrations: MigrationRecord = PROJECT_MIGRATIONS): SqliteStack => {
	const SqliteLayer = sqliteClientLayer({ filename });
	const MigratorLayer = Layer.effectDiscard(Effect.void).pipe(
		Layer.provide(
			Store.layer({ migrations: toStoreMigrations(migrations), ...LEDGER_OPTIONS }).pipe(Layer.provide(SqliteLayer)),
		),
	);
	return { SqliteLayer, MigratorLayer };
};

/**
 * What building a SQLite stack, and so `PlatformLive`, can fail with:
 * opening the database (`SqlError`), `@effected/store`'s setup /
 * ledger-adoption failure, or a failing migration.
 * @public
 */
export type PlatformLiveError = SqlError | StoreError | StoreMigrationError;

/**
 * Options for {@link PlatformLive}.
 * @public
 */
export interface PlatformOptions {
	/** Absolute path to the per-project `data.db`, or `":memory:"`. */
	readonly dbPath: string;
	/** The environment map the env-reading layers consult (the front end passes `process.env`). */
	readonly env: Record<string, string | undefined>;
	/** Optional log level override; when absent the logger is silent. */
	readonly logLevel?: LogLevel.LogLevel | undefined;
	/** Optional path for structured NDJSON log output. */
	readonly logFile?: string | undefined;
	/**
	 * Whether `PlatformLive` installs its own logger set (`LoggerLive`, from
	 * `logLevel` / `logFile`). Defaults to `true`. Pass `false` when the caller
	 * already owns the logger set (for example `@effected/cli`'s `CliLog`
	 * installed by `CliRuntime.main`'s `env.log`): `LoggerLive` replaces the
	 * installed loggers, so leaving it in would silence the caller's set.
	 * `logLevel` and `logFile` are ignored when this is `false`.
	 */
	readonly logger?: boolean | undefined;
}

/**
 * The services {@link PlatformLive} provides.
 * @public
 */
export type PlatformServices =
	| DataReader
	| DataStore
	| ProjectDiscovery
	| HistoryTracker
	| EnvironmentDetector
	| ExecutorResolver
	| DetailResolver
	| NodeServices.NodeServices
	| SqliteClient
	| SqlClient;

/**
 * The one platform assembly shared by the CLI, the MCP server and the Vitest
 * plugin: SQLite + migrator + Node platform services + Logger, with
 * `DataReader`, `DataStore`, `ProjectDiscovery`, `HistoryTracker` and the
 * output pipeline (`EnvironmentDetector`, `ExecutorResolver`,
 * `DetailResolver`) built over them.
 *
 * Every env read goes through `options.env`; the engine never touches
 * `process` itself.
 *
 * @param options - database path, env map and optional logging overrides
 * @public
 */
export const PlatformLive = (options: PlatformOptions): Layer.Layer<PlatformServices, PlatformLiveError> => {
	const { SqliteLayer, MigratorLayer } = makeSqliteStack(options.dbPath);

	const platform = Layer.mergeAll(ProjectDiscoveryLive, HistoryTrackerLive, OutputPipelineLive(options.env)).pipe(
		Layer.provideMerge(DataReaderLive),
		Layer.provideMerge(DataStoreLive),
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(NodePlatformLayer),
	);
	return options.logger === false
		? platform
		: platform.pipe(Layer.provideMerge(LoggerLive(options.logLevel, options.logFile, options.env)));
};
