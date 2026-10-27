/*
 * Hook-path resolution for the sidecar-family CLI subcommands
 * (`agent register-agent`, `agent end-agent`) and the native sidecar.
 *
 * Formerly `@vitest-agent/cli`'s `lib/sidecar-paths.ts`, which carried its
 * own `XDG_DATA_HOME` / `homedir()` resolver. That second resolver is gone:
 * the XDG root now comes from `@effected/xdg` — the same `Xdg` + `AppDirs`
 * services `resolveDataPath` is built on — driven by the caller's `env`
 * map rather than the ambient `process.env`.
 *
 * Path contract (unchanged):
 *
 *   - per-project data.db lives under
 *     $XDG_DATA_HOME/vitest-agent/<projectKey>/ (fallback
 *     ~/.local/share/vitest-agent/<projectKey>/)
 *   - the global registry.db lives under $XDG_DATA_HOME/vitest-agent/
 *   - the per-client sessions.db resolves via CLAUDE_PLUGIN_DATA,
 *     then VITEST_AGENT_SESSION_MAP_DIR, then ~/.vitest-agent/
 *     (HOME, then USERPROFILE)
 *
 * Every directory is created before its path is returned, exactly as the
 * former `mkdirSync(..., { recursive: true })` calls did.
 */

import type { AppStoreOptions } from "@effected/app";
import { AppStore } from "@effected/app";
import { LaunchContext } from "@effected/engine";
import { Store } from "@effected/store";
import type { AppDirsError, XdgEnvError } from "@effected/xdg";
import { AppDirs, Xdg } from "@effected/xdg";
import { ProjectIdentityNotResolvableError } from "@vitest-agent/sdk";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { APP_NAMESPACE, DATA_FALLBACK_DIR } from "../layers/PathResolutionLive.js";
import registryMigration0001 from "../migrations/registry_0001_initial.js";
import { LEDGER_OPTIONS } from "../stores.js";

/**
 * Filename of the per-project test-data SQLite database.
 *
 * @public
 */
export const DATA_DB_FILENAME = "data.db";

/**
 * Filename of the per-client session-map SQLite database.
 *
 * @public
 */
export const SESSIONS_DB_FILENAME = "sessions.db";

/**
 * Filename of the global discovery-registry SQLite database.
 *
 * @public
 */
export const REGISTRY_DB_FILENAME = "registry.db";

/**
 * The global discovery registry's store options: `registry.db` at the app's
 * XDG data root. `resolveHookPaths` resolves `registryDbPath` from them with
 * `AppStore.location`; `SidecarPlatformLive` opens that path with their
 * migrations.
 *
 * @internal
 */
export const REGISTRY_STORE_OPTIONS = {
	filename: REGISTRY_DB_FILENAME,
	directory: "data",
	migrations: Store.fromMigratorRecord({ "0001_initial": registryMigration0001 }),
	...LEDGER_OPTIONS,
} as const satisfies AppStoreOptions & { readonly filename: string };

/** Directory under the home dir that holds the per-client `sessions.db` fallback. */
const SESSION_MAP_HOME_DIR = `.${APP_NAMESPACE}`;

/**
 * The environment map every hook-path resolver reads from. The front end
 * passes `process.env`; the engine never reads `process` itself.
 *
 * @public
 */
export type HookEnv = Record<string, string | undefined>;

/**
 * The paths the sidecar-family subcommands open. Every directory has been
 * created by the time this value is returned.
 *
 * @public
 */
export interface HookPaths {
	/** `<XDG data>/vitest-agent` — holds `registry.db` and the per-project dirs. */
	readonly dataRoot: string;
	/** `<dataRoot>/<projectKey>` — holds the per-project `data.db`. */
	readonly projectDataDir: string;
	/** Absolute path to the per-project `data.db`. */
	readonly perProjectDbPath: string;
	/** Absolute path to the global `registry.db`. */
	readonly registryDbPath: string;
	/** Absolute path to the per-client `sessions.db`. */
	readonly sessionMapDbPath: string;
}

/**
 * Failures {@link resolveHookPaths} can surface: an unset `HOME` /
 * `USERPROFILE` (`XdgEnvError` for the data root,
 * `ProjectIdentityNotResolvableError` for the session map), a directory
 * that could not be created (`AppDirsError` / `PlatformError`).
 *
 * @public
 */
export type HookPathsError = XdgEnvError | AppDirsError | PlatformError | ProjectIdentityNotResolvableError;

const nonEmpty = (value: string | undefined): string | undefined =>
	value !== undefined && value.length > 0 ? value : undefined;

/**
 * The home directory the hook family falls back on: `HOME`, then
 * `USERPROFILE`, on every platform. Deliberately not `@effected/xdg`'s win32
 * order (`USERPROFILE` first): under Git Bash / MSYS the two differ, and
 * switching would move an existing `sessions.db`.
 */
const homeOf = (env: HookEnv): string | undefined => nonEmpty(env.HOME) ?? nonEmpty(env.USERPROFILE);

/**
 * `AppDirs` for the hook family, resolved from the caller's `env` map
 * through `Xdg.layerFromEnv` — no `process.env` read. `USERPROFILE` stands
 * in for `HOME` when the latter is unset (Windows), matching the
 * session-map fallback order below.
 */
const hookAppDirs = (env: HookEnv) => {
	const home = homeOf(env);
	return AppDirs.layer({ namespace: APP_NAMESPACE, fallbackDir: DATA_FALLBACK_DIR }).pipe(
		Layer.provide(Xdg.layerFromEnv({ ...env, ...(home !== undefined && { HOME: home }) })),
	);
};

/**
 * Resolve the per-client `sessions.db` path.
 *
 * Precedence: the `CLAUDE_PLUGIN_DATA` env var, then
 * `VITEST_AGENT_SESSION_MAP_DIR`, then `~/.vitest-agent/` (`HOME`, then
 * `USERPROFILE`). The two variables are read through `@effected/engine`'s
 * `LaunchContext.resolve`: a value is trimmed, and a blank or unsubstituted
 * `${...}` placeholder value counts as unset. The chosen directory is created. Fails with
 * `ProjectIdentityNotResolvableError` when no home directory is resolvable.
 *
 * @param env - the environment map to consult (the front end passes `process.env`)
 * @returns an Effect resolving to the absolute `sessions.db` path
 * @public
 */
export const resolveSessionMapPath = (
	env: HookEnv,
): Effect.Effect<string, ProjectIdentityNotResolvableError | PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const home = homeOf(env);
		const dir = LaunchContext.resolve({ env, keys: ["CLAUDE_PLUGIN_DATA", "VITEST_AGENT_SESSION_MAP_DIR"] }).pipe(
			Option.getOrElse(() => (home !== undefined ? path.join(home, SESSION_MAP_HOME_DIR) : undefined)),
		);
		if (dir === undefined) {
			return yield* new ProjectIdentityNotResolvableError({
				tried: [
					{ source: "CLAUDE_PLUGIN_DATA", reason: "env var not set" },
					{ source: "VITEST_AGENT_SESSION_MAP_DIR", reason: "env var not set" },
					{ source: "HOME", reason: "env var not set (USERPROFILE also unset)" },
				],
			});
		}
		yield* fs.makeDirectory(dir, { recursive: true });
		return path.join(dir, SESSIONS_DB_FILENAME);
	});

/**
 * Resolve (and create) every path the sidecar-family subcommands open for
 * `projectKey`: the per-project `data.db`, the global `registry.db` and the
 * per-client `sessions.db`. See the module header for the precedence rules.
 *
 * @param input - the environment map (the front end passes `process.env`)
 *   and the normalized project key (e.g. `@org__pkg`)
 * @returns an Effect resolving to the created {@link HookPaths}
 * @public
 */
export const resolveHookPaths = (input: {
	readonly env: HookEnv;
	readonly projectKey: string;
}): Effect.Effect<HookPaths, HookPathsError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;

		const dataRoot = yield* appDirs.ensureData;
		const projectDataDir = path.join(dataRoot, input.projectKey);
		yield* fs.makeDirectory(projectDataDir, { recursive: true });
		const sessionMapDbPath = yield* resolveSessionMapPath(input.env);

		return {
			dataRoot,
			projectDataDir,
			perProjectDbPath: path.join(projectDataDir, DATA_DB_FILENAME),
			registryDbPath: yield* AppStore.location(REGISTRY_STORE_OPTIONS),
			sessionMapDbPath,
		};
	}).pipe(Effect.provide(hookAppDirs(input.env)));
