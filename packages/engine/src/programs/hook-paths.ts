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

import type { AppDirsError, XdgEnvError } from "@effected/xdg";
import { AppDirs, Xdg } from "@effected/xdg";
import { ProjectIdentityNotResolvableError } from "@vitest-agent/sdk";
import { ConfigProvider, Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { APP_NAMESPACE } from "../layers/PathResolutionLive.js";

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
 * Where the XDG data root lands when `XDG_DATA_HOME` is unset:
 * `$HOME/.local/share/vitest-agent` — the XDG spec default the sidecar has
 * always used. (`AppDirs` alone would fall back to `$HOME/.vitest-agent`.)
 */
const HOOK_DATA_FALLBACK_DIR = `.local/share/${APP_NAMESPACE}`;

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
 * `AppDirs` for the hook family, resolved from the caller's `env` map.
 *
 * `Xdg.layer` reads `HOME` and `XDG_DATA_HOME` through the ambient
 * `ConfigProvider`, so the env map is installed as that provider — no
 * `process.env` read. `USERPROFILE` stands in for `HOME` when the latter is
 * unset (Windows), matching the session-map fallback order below.
 */
const hookAppDirs = (env: HookEnv) => {
	const home = nonEmpty(env.HOME) ?? nonEmpty(env.USERPROFILE);
	const provider = ConfigProvider.fromEnvRecord({ ...env, ...(home !== undefined && { HOME: home }) });
	const XdgLive = Xdg.layer.pipe(Layer.provide(ConfigProvider.layer(provider)));
	return AppDirs.layer({ namespace: APP_NAMESPACE, fallbackDir: HOOK_DATA_FALLBACK_DIR }).pipe(Layer.provide(XdgLive));
};

/**
 * Resolve the per-client `sessions.db` path.
 *
 * Precedence: the `CLAUDE_PLUGIN_DATA` env var, then
 * `VITEST_AGENT_SESSION_MAP_DIR`, then `~/.vitest-agent/` (`HOME`, then
 * `USERPROFILE`). The chosen directory is created. Fails with
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
		const home = nonEmpty(env.HOME) ?? nonEmpty(env.USERPROFILE);
		const dir =
			nonEmpty(env.CLAUDE_PLUGIN_DATA) ??
			nonEmpty(env.VITEST_AGENT_SESSION_MAP_DIR) ??
			(home !== undefined ? path.join(home, SESSION_MAP_HOME_DIR) : undefined);
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
			registryDbPath: path.join(dataRoot, REGISTRY_DB_FILENAME),
			sessionMapDbPath,
		};
	}).pipe(Effect.provide(hookAppDirs(input.env)));
