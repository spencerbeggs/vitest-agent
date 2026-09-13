import * as NodeServices from "@effect/platform-node/NodeServices";
import type { SqliteClient } from "@effect/sql-sqlite-node/SqliteClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { Effect, LogLevel } from "effect";
import { Layer } from "effect";
import type { MigrationError } from "effect/unstable/sql/Migrator";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
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
import type { FormatSelector } from "./services/FormatSelector.js";
import type { HistoryTracker } from "./services/HistoryTracker.js";
import type { OutputRenderer } from "./services/OutputRenderer.js";
import type { ProjectDiscovery } from "./services/ProjectDiscovery.js";

/**
 * A migration set in the shape `SqliteMigrator.fromRecord` accepts: migration
 * id → loader.
 * @public
 */
export type MigrationRecord = Record<string, Effect.Effect<void, unknown, SqlClient>>;

/**
 * A SQLite connection plus the migrator that brings it to the head of a
 * migration set. Returned by {@link makeSqliteStack}.
 * @public
 */
export interface SqliteStack {
	/** The `SqlClient` layer for `filename`. */
	readonly SqliteLayer: Layer.Layer<SqliteClient | SqlClient>;
	/**
	 * `Layer.effectDiscard`-shaped: provides nothing, runs the migrations as a
	 * side effect of layer acquisition. Already fed its `SqlClient` and the
	 * Node platform services.
	 */
	readonly MigratorLayer: Layer.Layer<never, MigrationError | SqlError>;
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
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(migrations),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, NodePlatformLayer)));
	return { SqliteLayer, MigratorLayer };
};

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
	| FormatSelector
	| DetailResolver
	| OutputRenderer
	| NodeServices.NodeServices
	| SqliteClient
	| SqlClient;

/**
 * The one platform assembly shared by the CLI, the MCP server and the Vitest
 * plugin: SQLite + migrator + Node platform services + Logger, with
 * `DataReader`, `DataStore`, `ProjectDiscovery`, `HistoryTracker` and the
 * output pipeline (`EnvironmentDetector`, `ExecutorResolver`,
 * `FormatSelector`, `DetailResolver`, `OutputRenderer`) built over them.
 *
 * Every env read goes through `options.env`; the engine never touches
 * `process` itself.
 *
 * @param options - database path, env map and optional logging overrides
 * @public
 */
export const PlatformLive = (options: PlatformOptions): Layer.Layer<PlatformServices, MigrationError | SqlError> => {
	const { SqliteLayer, MigratorLayer } = makeSqliteStack(options.dbPath);

	return Layer.mergeAll(ProjectDiscoveryLive, HistoryTrackerLive, OutputPipelineLive(options.env)).pipe(
		Layer.provideMerge(DataReaderLive),
		Layer.provideMerge(DataStoreLive),
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(NodePlatformLayer),
		Layer.provideMerge(LoggerLive(options.logLevel, options.logFile)),
	);
};
