/*
 * Sidecar platform assembly (formerly `@vitest-agent/cli`'s
 * `layers/SidecarLive.ts`).
 *
 * Wires the per-project data.db, the per-client sessions.db, the
 * registry.db, and the platform context (ChildProcessSpawner for git
 * probes) into a single layer the `agent register-agent` /
 * `agent end-agent` programs consume.
 *
 * Three SQLite handles are open per sidecar invocation, each an
 * `@effected/store` store with `adoptMigratorLedger` on:
 *   - per-project data.db — DataStore + DataReader (`makeSqliteStack`)
 *   - per-client sessions.db — PerClientSessionMapWriter (also
 *     satisfies PerClientSessionMapReader); an absolute, host-chosen
 *     path, so `Store.layerSqliteAs`
 *   - global registry.db — DiscoveryRegistry; the XDG data root, so
 *     `@effected/app`'s `AppStore.layerAs` (`directory: "data"`)
 *
 * Each handle is short-lived: the sidecar process exits immediately
 * after the subcommand returns. WAL mode plus a 5 s busy timeout (the
 * driver's own per-connection settings) absorb concurrency between
 * sidecar processes from parallel hooks.
 */

import { AppStore } from "@effected/app";
import { Store } from "@effected/store";
import { Layer } from "effect";
import { DataReaderLive } from "../layers/DataReaderLive.js";
import { DataStoreLive } from "../layers/DataStoreLive.js";
import { DiscoveryRegistryLive } from "../layers/DiscoveryRegistryLive.js";
import { LoggerLive } from "../layers/LoggerLive.js";
import { PerClientSessionMapWriterLive } from "../layers/PerClientSessionMapLive.js";
import { RunContextLive } from "../layers/RunContextLive.js";
import sessionMapMigration0001 from "../migrations/session_map_0001_initial.js";
import { NodePlatformLayer, makeSqliteStack } from "../platform.js";
import { LEDGER_OPTIONS, RegistryStore, SessionMapStore, toStoreMigrations } from "../stores.js";
import { REGISTRY_STORE_OPTIONS, hookAppDirs } from "./hook-paths.js";

/**
 * SQLite database paths consumed by {@link SidecarPlatformLive}.
 * Structurally a subset of `HookPaths` from `resolveHookPaths`, so the
 * resolver's result can be passed straight in.
 *
 * @public
 */
export interface SidecarPaths {
	/** Absolute path to the per-project `data.db`. */
	readonly perProjectDbPath: string;
	/** Absolute path to the per-client `sessions.db`. */
	readonly sessionMapDbPath: string;
	/** Absolute path to the global `registry.db`. */
	readonly registryDbPath: string;
}

/**
 * Build the sidecar Live layer for the supplied SQLite paths.
 *
 * Each store gets its own `SqlClient` connection (separate scopes,
 * independent migrators, all built through the engine's shared
 * `makeSqliteStack`) so concurrent operations on the three stores
 * don't share lock state.
 *
 * @param paths - the three SQLite database paths to open
 * @param env - the environment map `RunContextLive` probes for host
 *   metadata (the bin passes `process.env`)
 * @public
 */
export const SidecarPlatformLive = (paths: SidecarPaths, env: Record<string, string | undefined>) => {
	// Per-project data.db
	const project = makeSqliteStack(paths.perProjectDbPath);
	const ProjectStoreLayer = Layer.mergeAll(
		DataStoreLive.pipe(Layer.provide(project.SqliteLayer)),
		DataReaderLive.pipe(Layer.provide(project.SqliteLayer)),
		project.MigratorLayer,
	);

	// Per-client session map (sessions.db)
	const SessionMapLayer = PerClientSessionMapWriterLive.pipe(
		Layer.provide(Store.sqlClient(SessionMapStore)),
		Layer.provide(
			Store.layerSqliteAs(SessionMapStore, {
				filename: paths.sessionMapDbPath,
				migrations: toStoreMigrations({ "0001_initial": sessionMapMigration0001 }),
				...LEDGER_OPTIONS,
			}),
		),
	);

	// Global discovery registry, at the app's XDG data root. The options are
	// the ones `resolveHookPaths` resolves `registryDbPath` from (through
	// `AppStore.location`), so this opens exactly the file it reports.
	const RegistryLayer = DiscoveryRegistryLive.pipe(
		Layer.provide(Store.sqlClient(RegistryStore)),
		Layer.provide(AppStore.layerAs(RegistryStore, REGISTRY_STORE_OPTIONS)),
		Layer.provide(hookAppDirs(env)),
		Layer.provide(NodePlatformLayer),
	);

	return Layer.mergeAll(ProjectStoreLayer, SessionMapLayer, RegistryLayer, RunContextLive(env)).pipe(
		Layer.provideMerge(NodePlatformLayer),
		Layer.provideMerge(LoggerLive()),
	);
};
