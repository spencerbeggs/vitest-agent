import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Layer } from "effect";
import { DataReaderLive } from "../layers/DataReaderLive.js";
import { DataStoreLive } from "../layers/DataStoreLive.js";
import { PROJECT_MIGRATIONS } from "../migrations/index.js";
/** @public */
export function makeTestLayer(filename: string) {
	const SqliteLayer = sqliteClientLayer({ filename });
	const PlatformLayer = NodeServices.layer;

	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord(PROJECT_MIGRATIONS),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

	return Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(SqliteLayer)),
		DataReaderLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		PlatformLayer,
	);
}
/** @public */
export const DataStoreTestLayer = makeTestLayer(":memory:");
