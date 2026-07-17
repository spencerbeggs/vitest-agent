import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import {
	DataReaderLive,
	DataStoreLive,
	LoggerLive,
	OutputPipelineLive,
	ProjectDiscoveryLive,
	migration0001,
} from "@vitest-agent/sdk";
import type { LogLevel } from "effect";
import { Layer } from "effect";

/**
 * Builds the Effect Layer that provides all services required by the MCP server.
 *
 * Composes DataReader, DataStore, ProjectDiscovery, OutputPipeline, SQLite
 * client, migrator, NodeServices, and the logger into a single
 * layer suitable for `ManagedRuntime.make`.
 *
 * @param dbPath - absolute path to the SQLite database file
 * @param logLevel - optional log level; defaults to the logger's own default
 * @param logFile - optional path to write structured log output
 * @returns an Effect Layer providing all MCP runtime services
 * @public
 */
export const McpLive = (dbPath: string, logLevel?: LogLevel.LogLevel, logFile?: string) => {
	const SqliteLayer = sqliteClientLayer({ filename: dbPath });
	// `NodeServices.layer` aggregates FileSystem | Path | ChildProcessSpawner |
	// Crypto | Stdio | Terminal — it subsumes the v3 NodeContext + the separate
	// NodeFileSystem layer.
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(DataReaderLive, DataStoreLive, ProjectDiscoveryLive, OutputPipelineLive).pipe(
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(PlatformLayer),
		Layer.provideMerge(LoggerLive(logLevel, logFile)),
	);
};
