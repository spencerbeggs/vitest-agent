import { NodeFileSystem } from "@effect/platform-node";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { LogLevel } from "effect";
import { Layer } from "effect";
import {
	DataReaderLive,
	DataStoreLive,
	LoggerLive,
	OutputPipelineLive,
	ProjectDiscoveryLive,
	migration0001,
	migration0002,
} from "vitest-agent-sdk";

export const McpLive = (dbPath: string, logLevel?: LogLevel.LogLevel, logFile?: string) => {
	const SqliteLayer = sqliteClientLayer({ filename: dbPath });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
			"0002_comprehensive": migration0002,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(DataReaderLive, DataStoreLive, ProjectDiscoveryLive, OutputPipelineLive).pipe(
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(PlatformLayer),
		Layer.provideMerge(NodeFileSystem.layer),
		Layer.provideMerge(LoggerLive(logLevel, logFile)),
	);
};
