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
