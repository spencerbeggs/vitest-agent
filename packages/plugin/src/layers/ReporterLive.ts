import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import type { LogLevel } from "effect";
import { Layer } from "effect";
import {
	DataReaderLive,
	DataStoreLive,
	HistoryTrackerLive,
	LoggerLive,
	OutputPipelineLive,
	migration0001,
} from "vitest-agent-sdk";
import { CoverageAnalyzerLive } from "./CoverageAnalyzerLive.js";

export const ReporterLive = (dbPath: string, logLevel?: LogLevel.LogLevel, logFile?: string) => {
	const SqliteLayer = sqliteClientLayer({ filename: dbPath });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(DataStoreLive, CoverageAnalyzerLive, HistoryTrackerLive, OutputPipelineLive).pipe(
		Layer.provideMerge(DataReaderLive),
		Layer.provideMerge(MigratorLayer),
		Layer.provideMerge(SqliteLayer),
		Layer.provideMerge(PlatformLayer),
		Layer.provideMerge(LoggerLive(logLevel, logFile)),
	);
};
