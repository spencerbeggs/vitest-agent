import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AppDirs } from "@effected/xdg";
import { Effect } from "effect";
import { VitestAgentConfig } from "../schemas/Config.js";
import { VitestAgentConfigFile } from "../services/Config.js";
import { normalizeWorkspaceKey } from "./normalize-workspace-key.js";
import { resolveProjectKeyFromCwd } from "./resolve-project-key-from-cwd.js";

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
 * 3. `<XDG data>/<normalized projectKey from config>/data.db`.
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
		// 1. Programmatic override wins.
		if (options.cacheDir) {
			ensureDirSync(options.cacheDir);
			return join(options.cacheDir, DATABASE_FILENAME);
		}

		const config = yield* VitestAgentConfigFile;
		const loaded = yield* config.loadOrDefault(new VitestAgentConfig({}));

		// 2. Config file cacheDir.
		if (loaded.cacheDir) {
			ensureDirSync(loaded.cacheDir);
			return join(loaded.cacheDir, DATABASE_FILENAME);
		}

		const appDirs = yield* AppDirs;
		const dataRoot = yield* appDirs.ensureData;

		// 3. Config file projectKey overrides cwd-derived projectKey.
		const key = loaded.projectKey ? normalizeWorkspaceKey(loaded.projectKey) : resolveProjectKeyFromCwd(projectDir);

		const dir = join(dataRoot, key);
		ensureDirSync(dir);
		return join(dir, DATABASE_FILENAME);
	});

const ensureDirSync = (path: string): void => {
	mkdirSync(path, { recursive: true });
};
