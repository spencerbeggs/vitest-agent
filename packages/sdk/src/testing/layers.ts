import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Layer } from "effect";
import { DataReaderLive } from "../layers/DataReaderLive.js";
import { DataStoreLive } from "../layers/DataStoreLive.js";
import migration0001 from "../migrations/0001_initial.js";
import migration0002 from "../migrations/0002_comprehensive.js";

export function makeTestLayer(filename: string) {
	const SqliteLayer = sqliteClientLayer({ filename });
	const PlatformLayer = NodeContext.layer;

	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({
			"0001_initial": migration0001,
			"0002_comprehensive": migration0002,
		}),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(SqliteLayer)),
		DataReaderLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		PlatformLayer,
	);
}

export const DataStoreTestLayer = makeTestLayer(":memory:");
