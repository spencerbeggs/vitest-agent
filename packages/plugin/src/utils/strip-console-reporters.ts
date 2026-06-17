/**
 * @vitest-agent/plugin
 *
 * Filter out built-in console reporters from a Vitest reporters array.
 *
 * @packageDocumentation
 */

/**
 * Built-in Vitest reporters that write to the console (stdout).
 * These are the reporters suppressed when an agent takes over console output.
 *
 * @privateRemarks
 * `"agent"` is the built-in Vitest reporter added in v4.1 that reduces
 * console noise for AI agents. We strip it because our reporter replaces
 * its functionality with structured markdown output.
 *
 * @see {@link https://vitest.dev/api/advanced/reporters.html | Vitest Reporter docs}
 * @internal
 */
export const CONSOLE_REPORTERS = new Set([
	"default",
	"verbose",
	"tree",
	"dot",
	"tap",
	"tap-flat",
	"hanging-process",
	"agent",
]);

/**
 * Filter out built-in console reporters from a Vitest reporters array.
 *
 * Keeps custom reporters (class instances, file paths) and non-console
 * built-in reporters (`json`, `junit`, `html`, `blob`, `github-actions`).
 * Used by {@link AgentPlugin} in agent mode to suppress noisy console output.
 *
 * @param reporters - The Vitest `config.reporters` array
 * @returns Filtered array with console reporters removed
 *
 * @internal
 */
export function stripConsoleReporters(reporters: unknown[]): unknown[] {
	return reporters.filter((entry) => {
		// String name: "default", "verbose", etc.
		if (typeof entry === "string") {
			return !CONSOLE_REPORTERS.has(entry);
		}
		// Tuple: ["default", { options }]
		if (Array.isArray(entry) && typeof entry[0] === "string") {
			return !CONSOLE_REPORTERS.has(entry[0]);
		}
		// Class instance, file path with options, or unknown -- keep it
		return true;
	});
}
