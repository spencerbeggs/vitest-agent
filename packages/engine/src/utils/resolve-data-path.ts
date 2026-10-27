import { join } from "node:path";
import { AppDirs } from "@effected/xdg";
import { ProjectIdentitySourceError, VitestAgentConfig } from "@vitest-agent/sdk";
import { Effect, FileSystem, Result } from "effect";
import { VitestAgentConfigFile } from "../services/Config.js";
import { resolveProjectKeyFromCwdEffect } from "./resolve-project-key-from-cwd.js";

/**
 * Filename of the SQLite database that stores all reporter data.
 * @public
 */
export const DATABASE_FILENAME = "data.db";

/**
 * Caller-supplied overrides for `resolveDataPath`.
 * @public
 */
export interface ResolveDataPathOptions {
	/**
	 * Programmatic override for the entire data directory. Highest precedence.
	 *
	 * Use this when the reporter or plugin user has explicitly set
	 * `reporter.cacheDir`. The returned path is `<cacheDir>/data.db`.
	 */
	readonly cacheDir?: string;
}

/**
 * The data directory name for a `projectKey` from `vitest-agent.config.toml`,
 * or a `ProjectIdentitySourceError` (source `toml`) when it maps to `.` or
 * `..` — the same refusal `ProjectIdentityLive` gives the same key.
 */
const configuredKey = (projectKey: string, projectDir: string): Effect.Effect<string, ProjectIdentitySourceError> =>
	Result.match(AppDirs.segment(projectKey), {
		onSuccess: Effect.succeed,
		onFailure: (cause) =>
			Effect.fail(
				new ProjectIdentitySourceError({
					source: "toml",
					path: projectDir,
					detail: `projectKey ${JSON.stringify(projectKey)} is not a usable directory name (${cause.message})`,
					cause,
				}),
			),
	});

/**
 * Resolve the absolute path to the SQLite database for `projectDir`.
 *
 * The directory containing the database is ensured to exist before the
 * function returns, so callers can open the database immediately without
 * needing to create parent directories. The SQLite driver creates the file
 * but not its parent.
 *
 * Precedence (highest first):
 *
 * 1. `options.cacheDir` — programmatic override.
 * 2. `cacheDir` from `vitest-agent.config.toml`.
 * 3. `<XDG data>/<normalized projectKey from config>/data.db`. A
 *    `projectKey` that normalizes to `.` or `..` fails with
 *    `ProjectIdentitySourceError` (source `toml`) rather than writing
 *    outside the data root.
 * 4. `<XDG data>/<projectKey resolved from cwd's package.json>/data.db`.
 *    Source 4 prefers `repository.url` (canonicalized to `host__path`),
 *    falling back to the normalized `name`. This matches the sidecar
 *    CLI's `_internal register-agent` resolver so the reporter and
 *    sidecar always write to the same `data.db`.
 *
 * The XDG data directory is namespaced via `AppDirs` (typically
 * `$XDG_DATA_HOME/vitest-agent`, defaulting to
 * `~/.local/share/vitest-agent`).
 *
 * The path is a function of identity, not filesystem layout. When no
 * `package.json` is reachable from `projectDir`, the cwd basename is used
 * as the final fallback so the function never throws on identity lookup.
 *
 * @param projectDir - Absolute path inside the user's workspace.
 * @param options - Optional programmatic overrides.
 * @public
 */
export const resolveDataPath = (projectDir: string, options: ResolveDataPathOptions = {}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		// 1. Programmatic override wins.
		if (options.cacheDir) {
			yield* fs.makeDirectory(options.cacheDir, { recursive: true });
			return join(options.cacheDir, DATABASE_FILENAME);
		}

		const config = yield* VitestAgentConfigFile;
		const loaded = yield* config.loadOrDefault(new VitestAgentConfig({}));

		// 2. Config file cacheDir.
		if (loaded.cacheDir) {
			yield* fs.makeDirectory(loaded.cacheDir, { recursive: true });
			return join(loaded.cacheDir, DATABASE_FILENAME);
		}

		const appDirs = yield* AppDirs;
		const dataRoot = yield* appDirs.ensureData;

		// 3. Config file projectKey overrides cwd-derived projectKey.
		// `AppDirs.segment` maps the key to one directory name and refuses
		// `.` / `..`, which would land outside the data root.
		const key = loaded.projectKey
			? yield* configuredKey(loaded.projectKey, projectDir)
			: yield* resolveProjectKeyFromCwdEffect(projectDir);

		const dir = join(dataRoot, key);
		yield* fs.makeDirectory(dir, { recursive: true });
		return join(dir, DATABASE_FILENAME);
	});
