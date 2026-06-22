import { NodeFileSystem } from "@effect/platform-node";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import {
	DataReaderLive,
	DataStoreLive,
	HistoryTrackerLive,
	LoggerLive,
	OutputPipelineLive,
	ProjectDiscoveryLive,
	migration0001,
} from "@vitest-agent/sdk";
import type { LogLevel } from "effect";
import { Layer } from "effect";

/**
 * Composition layer for the CLI runtime.
 *
 * Wires `DataReader`, `ProjectDiscovery`, `HistoryTracker`,
 * `OutputPipeline`, `SqliteClient`, the DB migrator, `NodeContext`,
 * `NodeFileSystem`, and `Logger` into a single layer the `vitest-agent`
 * bin provides to `Command.run`.
 *
 * @param dbPath - absolute path to the per-project `data.db`
 * @param logLevel - optional log level override; defaults to `Info`
 * @param logFile - optional path for structured log output
 * @public
 */
export const CliLive = (dbPath: string, logLevel?: LogLevel.LogLevel, logFile?: string) => {
	const SqliteLayer = sqliteClientLayer({ filename: dbPath });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(ProjectDiscoveryLive, HistoryTrackerLive, OutputPipelineLive).pipe(
		Layer.provideMerge(DataReaderLive),
		Layer.provideMerge(DataStoreLive),
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(PlatformLayer),
		Layer.provideMerge(NodeFileSystem.layer),
		Layer.provideMerge(LoggerLive(logLevel, logFile)),
	);
};
