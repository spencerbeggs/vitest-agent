/**
 * @vitest-agent/sdk
 *
 * Compress an array of line numbers into a compact range string.
 *
 * @packageDocumentation
 */

/**
 * Compress an array of line numbers into a compact range string.
 *
 * Consecutive line numbers are collapsed into `start-end` ranges,
 * separated by commas. Duplicate values are removed and the input
 * is sorted ascending before processing.
 *
 * @param lines - Array of line numbers to compress
 * @returns Compressed range string, or empty string for empty input
 *
 * @example
 * ```typescript
 * import { compressLines } from "@vitest-agent/sdk/utils";
 *
 * compressLines([1, 2, 3, 5, 10, 11, 12]);
 * // Returns: "1-3,5,10-12"
 *
 * compressLines([42]);
 * // Returns: "42"
 *
 * compressLines([]);
 * // Returns: ""
 * ```
 *
 * @public
 */
export function compressLines(lines: number[]): string {
	if (lines.length === 0) return "";

	// Sort and deduplicate
	const sorted = [...new Set(lines)].sort((a, b) => a - b);

	const ranges: string[] = [];
	let start = sorted[0];
	let end = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === end + 1) {
			end = sorted[i];
		} else {
			ranges.push(start === end ? `${start}` : `${start}-${end}`);
			start = sorted[i];
			end = sorted[i];
		}
	}
	ranges.push(start === end ? `${start}` : `${start}-${end}`);

	return ranges.join(",");
}
