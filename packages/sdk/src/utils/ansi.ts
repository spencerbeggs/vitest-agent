/**
 * @vitest-agent/sdk
 *
 * ANSI color/style escape code utilities.
 *
 * @packageDocumentation
 */

/**
 * Options for ANSI color output control.
 *
 * @internal
 */
export interface AnsiOptions {
	noColor?: boolean;
}

const ANSI_CODES: Record<string, [number, number]> = {
	reset: [0, 0],
	bold: [1, 22],
	dim: [2, 22],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	cyan: [36, 39],
};

/**
 * Wrap text with an ANSI color/style escape code.
 *
 * No-ops when `options.noColor` is true, keeping output as valid plain
 * markdown when captured by agents or piped to files.
 *
 * @privateRemarks
 * Uses raw ANSI escape sequences (`\x1b[...m`) rather than a dependency
 * like `chalk` or `picocolors` to keep the package zero-dependency. The
 * `noColor` flag respects the `NO_COLOR` environment variable convention.
 *
 * @param text - Text to wrap
 * @param color - ANSI code name: `reset`, `bold`, `dim`, `red`, `green`, `yellow`, `cyan`
 * @param options - Control color output
 * @returns Text with ANSI escape codes, or plain text if noColor
 *
 * @see {@link https://no-color.org/ | NO_COLOR convention}
 * @internal
 */
export function ansi(text: string, color: string, options?: AnsiOptions): string {
	if (options?.noColor) return text;
	const codes = ANSI_CODES[color];
	if (!codes) return text;
	return `\x1b[${codes[0]}m${text}\x1b[${codes[1]}m`;
}

/**
 * Strip all ANSI escape codes from a string.
 *
 * @param text - String potentially containing ANSI escape sequences
 * @returns Plain text with all escape sequences removed
 *
 * @internal
 */
export function stripAnsi(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips ANSI escape sequences
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}
