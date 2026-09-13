import { Layer } from "effect";
import { DataReaderLive } from "../layers/DataReaderLive.js";
import { DataStoreLive } from "../layers/DataStoreLive.js";
import { NodePlatformLayer, makeSqliteStack } from "../platform.js";
/** @public */
export function makeTestLayer(filename: string) {
	const { SqliteLayer, MigratorLayer } = makeSqliteStack(filename);

	return Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(SqliteLayer)),
		DataReaderLive.pipe(Layer.provide(SqliteLayer)),
		MigratorLayer,
		SqliteLayer,
		NodePlatformLayer,
	);
}
/** @public */
export const DataStoreTestLayer = makeTestLayer(":memory:");
