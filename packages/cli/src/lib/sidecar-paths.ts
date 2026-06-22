/*
 * Shared sidecar path-resolution helpers.
 *
 * These helpers were extracted from commands/agent.ts so the
 * vitest-agent agent subcommands and the sidecar native binary call
 * byte-identical path-resolution logic. The sidecar binary re-uses
 * the CLI as a library, so any divergence here would silently fork
 * the two implementations.
 *
 * Path resolution mirrors the database-location contract:
 *
 *   - per-project data.db lives under
 *     $XDG_DATA_HOME/vitest-agent/<projectKey>/
 *   - the global registry.db lives under $XDG_DATA_HOME/vitest-agent/
 *   - the per-client sessions.db resolves via CLAUDE_PLUGIN_DATA,
 *     then VITEST_AGENT_SESSION_MAP_DIR, then ~/.vitest-agent/
 *
 * The tagged-error to exit-code mapping (exitCodeForTag) moved to
 * @vitest-agent/sdk/dispatch alongside the rest of the sidecar
 * dispatch core; import it from there.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProjectIdentityNotResolvableError } from "@vitest-agent/sdk";
import { Effect } from "effect";

const APP_NAMESPACE = "vitest-agent";

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

const resolveXdgDataHome = (): string => {
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg !== undefined && xdg.length > 0) return xdg;
	return join(homedir(), ".local", "share");
};

/**
 * Resolve (and create) the per-project data directory for the supplied
 * normalized `projectKey`. Returns the directory; callers join
 * {@link DATA_DB_FILENAME} onto it for the `data.db` path.
 *
 * @param projectKey - normalized project key (e.g. `@org__pkg`)
 * @returns absolute path to the resolved (and created) data directory
 * @public
 */
export const resolveProjectDataDir = (projectKey: string): string => {
	const dir = join(resolveXdgDataHome(), APP_NAMESPACE, projectKey);
	mkdirSync(dir, { recursive: true });
	return dir;
};

/**
 * Resolve (and create) the directory holding the global `registry.db`.
 * Callers join {@link REGISTRY_DB_FILENAME} onto it.
 *
 * @returns absolute path to the resolved (and created) registry directory
 * @public
 */
export const resolveRegistryDir = (): string => {
	const dir = join(resolveXdgDataHome(), APP_NAMESPACE);
	mkdirSync(dir, { recursive: true });
	return dir;
};

/**
 * Resolve the per-client `sessions.db` path.
 *
 * Precedence: the `CLAUDE_PLUGIN_DATA` env var, then
 * `VITEST_AGENT_SESSION_MAP_DIR`, then `~/.vitest-agent/`. Fails
 * with `ProjectIdentityNotResolvableError` when no home directory
 * is resolvable.
 *
 * @returns an Effect resolving to the absolute `sessions.db` path
 * @public
 */
export const resolveSessionMapPath = (): Effect.Effect<string, ProjectIdentityNotResolvableError> =>
	Effect.sync(() => {
		const claudePluginData = process.env.CLAUDE_PLUGIN_DATA;
		if (claudePluginData !== undefined && claudePluginData.length > 0) {
			mkdirSync(claudePluginData, { recursive: true });
			return join(claudePluginData, SESSIONS_DB_FILENAME);
		}
		const overrideDir = process.env.VITEST_AGENT_SESSION_MAP_DIR;
		if (overrideDir !== undefined && overrideDir.length > 0) {
			mkdirSync(overrideDir, { recursive: true });
			return join(overrideDir, SESSIONS_DB_FILENAME);
		}
		const home = process.env.HOME ?? process.env.USERPROFILE;
		if (home === undefined || home.length === 0) {
			return null;
		}
		const fallbackDir = join(home, ".vitest-agent");
		mkdirSync(fallbackDir, { recursive: true });
		return join(fallbackDir, SESSIONS_DB_FILENAME);
	}).pipe(
		Effect.flatMap((path) =>
			path !== null
				? Effect.succeed(path)
				: Effect.fail(
						new ProjectIdentityNotResolvableError({
							tried: [
								{ source: "CLAUDE_PLUGIN_DATA", reason: "env var not set" },
								{ source: "VITEST_AGENT_SESSION_MAP_DIR", reason: "env var not set" },
								{ source: "HOME", reason: "env var not set (USERPROFILE also unset)" },
							],
						}),
					),
		),
	);
