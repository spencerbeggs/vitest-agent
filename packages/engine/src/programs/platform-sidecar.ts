/*
 * Sidecar platform assembly (formerly `@vitest-agent/cli`'s
 * `layers/SidecarLive.ts`).
 *
 * Wires the per-project data.db, the per-client sessions.db, the
 * registry.db, and the platform context (ChildProcessSpawner for git
 * probes) into a single layer the `agent register-agent` /
 * `agent end-agent` programs consume.
 *
 * Three SQLite handles are open per sidecar invocation:
 *   - per-project data.db — DataStore + DataReader
 *   - per-client sessions.db — PerClientSessionMapWriter (also
 *     satisfies PerClientSessionMapReader)
 *   - global registry.db — DiscoveryRegistry
 *
 * Each handle is short-lived: the sidecar process exits immediately
 * after the subcommand returns. WAL mode plus busy_timeout=5000
 * absorb concurrency between sidecar processes from parallel hooks.
 */

import { Layer } from "effect";
import { DataReaderLive } from "../layers/DataReaderLive.js";
import { DataStoreLive } from "../layers/DataStoreLive.js";
import { DiscoveryRegistryLive } from "../layers/DiscoveryRegistryLive.js";
import { LoggerLive } from "../layers/LoggerLive.js";
import { PerClientSessionMapWriterLive } from "../layers/PerClientSessionMapLive.js";
import { RunContextLive } from "../layers/RunContextLive.js";
import registryMigration0001 from "../migrations/registry_0001_initial.js";
import sessionMapMigration0001 from "../migrations/session_map_0001_initial.js";
import { NodePlatformLayer, makeSqliteStack } from "../platform.js";

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
	const sessionMap = makeSqliteStack(paths.sessionMapDbPath, { "0001_initial": sessionMapMigration0001 });
	const SessionMapLayer = Layer.mergeAll(
		PerClientSessionMapWriterLive.pipe(Layer.provide(sessionMap.SqliteLayer)),
		sessionMap.MigratorLayer,
	);

	// Global discovery registry
	const registry = makeSqliteStack(paths.registryDbPath, { "0001_initial": registryMigration0001 });
	const RegistryLayer = Layer.mergeAll(
		DiscoveryRegistryLive.pipe(Layer.provide(registry.SqliteLayer)),
		registry.MigratorLayer,
	);

	return Layer.mergeAll(ProjectStoreLayer, SessionMapLayer, RegistryLayer, RunContextLive(env)).pipe(
		Layer.provideMerge(NodePlatformLayer),
		Layer.provideMerge(LoggerLive()),
	);
};
