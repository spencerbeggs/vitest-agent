/**
 * Sidecar layer composition.
 *
 * Wires the per-project data.db, the per-client sessions.db, the
 * registry.db, and the platform context (`CommandExecutor` for git
 * probes) into a single layer the `_internal` CLI subcommands
 * consume.
 *
 * Three SQLite handles are open per sidecar invocation:
 *   - per-project `data.db` — `DataStore` + `DataReader`
 *   - per-client `sessions.db` — `PerClientSessionMapWriter` (also
 *     satisfies `PerClientSessionMapReader`)
 *   - global `registry.db` — `DiscoveryRegistry`
 *
 * Each handle is short-lived: the sidecar process exits immediately
 * after the subcommand returns. WAL mode plus `busy_timeout=5000`
 * absorb concurrency between sidecar processes from parallel hooks.
 *
 * @packageDocumentation
 */

import { NodeFileSystem } from "@effect/platform-node";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Layer } from "effect";
import {
	DataReaderLive,
	DataStoreLive,
	DiscoveryRegistryLive,
	LoggerLive,
	PerClientSessionMapWriterLive,
	RunContextLive,
	migration0001,
	registryMigration0001,
	sessionMapMigration0001,
} from "vitest-agent-sdk";

export interface SidecarPaths {
	readonly perProjectDbPath: string;
	readonly sessionMapDbPath: string;
	readonly registryDbPath: string;
}

/**
 * Build the sidecar Live layer for the supplied SQLite paths.
 *
 * Each store gets its own `SqlClient` connection (separate scopes,
 * independent migrators) so concurrent operations on the three
 * stores don't share lock state.
 */
export const SidecarLive = (paths: SidecarPaths) => {
	const PlatformLayer = NodeContext.layer;

	// Per-project data.db
	const ProjectSqliteLayer = sqliteClientLayer({ filename: paths.perProjectDbPath });
	const ProjectMigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
	}).pipe(Layer.provide(Layer.merge(ProjectSqliteLayer, PlatformLayer)));
	const ProjectStoreLayer = Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(ProjectSqliteLayer)),
		DataReaderLive.pipe(Layer.provide(ProjectSqliteLayer)),
		ProjectMigratorLayer,
	);

	// Per-client session map (sessions.db)
	const SessionMapSqliteLayer = sqliteClientLayer({ filename: paths.sessionMapDbPath });
	const SessionMapMigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": sessionMapMigration0001 }),
	}).pipe(Layer.provide(Layer.merge(SessionMapSqliteLayer, PlatformLayer)));
	const SessionMapLayer = Layer.mergeAll(
		PerClientSessionMapWriterLive.pipe(Layer.provide(SessionMapSqliteLayer)),
		SessionMapMigratorLayer,
	);

	// Global discovery registry
	const RegistrySqliteLayer = sqliteClientLayer({ filename: paths.registryDbPath });
	const RegistryMigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": registryMigration0001 }),
	}).pipe(Layer.provide(Layer.merge(RegistrySqliteLayer, PlatformLayer)));
	const RegistryLayer = Layer.mergeAll(
		DiscoveryRegistryLive.pipe(Layer.provide(RegistrySqliteLayer)),
		RegistryMigratorLayer,
	);

	return Layer.mergeAll(ProjectStoreLayer, SessionMapLayer, RegistryLayer, RunContextLive).pipe(
		Layer.provideMerge(PlatformLayer),
		Layer.provideMerge(NodeFileSystem.layer),
		Layer.provideMerge(LoggerLive()),
	);
};
