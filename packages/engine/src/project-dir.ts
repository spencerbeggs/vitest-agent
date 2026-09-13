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
 * then `cwd`. An empty string counts as unset. Pure: both the env map and
 * the working directory are injected by the caller.
 *
 * @param input - the env map and the fallback working directory
 * @public
 */
export const resolveProjectDir = (input: {
	readonly env: Record<string, string | undefined>;
	readonly cwd: string;
}): string => {
	for (const key of PROJECT_DIR_ENV_KEYS) {
		const value = input.env[key];
		if (value !== undefined && value !== "") return value;
	}
	return input.cwd;
};
