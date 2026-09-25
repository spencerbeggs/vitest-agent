import { LaunchContext } from "@effected/engine";

/**
 * Environment variables that may override the project directory, in
 * precedence order (highest first).
 */
const PROJECT_DIR_ENV_KEYS = [
	"VITEST_AGENT_PROJECT_DIR",
	"VITEST_AGENT_REPORTER_PROJECT_DIR",
	"CLAUDE_PROJECT_DIR",
] as const;

/**
 * Resolve the project directory the front ends anchor on.
 *
 * Precedence: `VITEST_AGENT_PROJECT_DIR` (hook-driven override), then
 * `VITEST_AGENT_REPORTER_PROJECT_DIR` (the plugin-spawned MCP server's
 * hand-off), then `CLAUDE_PROJECT_DIR` (Claude Code's own convention),
 * then `cwd`. Delegates to `@effected/engine`'s `LaunchContext.projectDir`:
 * a value is trimmed, and an empty or whitespace-only value, or one a plugin
 * host left as a literal unsubstituted `${...}` placeholder, counts as unset.
 * Pure: both the env map and the working directory are injected by the caller.
 *
 * @param input - the env map and the fallback working directory
 * @public
 */
export const resolveProjectDir = (input: {
	readonly env: Record<string, string | undefined>;
	readonly cwd: string;
}): string => LaunchContext.projectDir({ env: input.env, keys: PROJECT_DIR_ENV_KEYS, cwd: input.cwd });
