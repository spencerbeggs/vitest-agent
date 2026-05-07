import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Layer } from "effect";
import migration0001 from "../migrations/0001_initial.js";
import migration0002 from "../migrations/0002_comprehensive.js";
import { DataReaderLive } from "./DataReaderLive.js";
import { DataStoreLive } from "./DataStoreLive.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeContext.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
		"0002_comprehensive": migration0002,
	}),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

export const DataStoreTestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(SqliteLayer)),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);
