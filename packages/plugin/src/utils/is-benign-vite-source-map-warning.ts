/**
 * Matches the benign Vite core warning emitted when a dependency's shipped
 * `.js` file references a `.js.map` sibling that was never published in the
 * npm tarball (the canonical example: `typescript/lib/typescript.js` /
 * `typescript.js.map`). Vite core's `loadAndTransform` logs this through
 * `environment.logger.warn` — not through per-test console output — so it
 * cannot be filtered by the console-leak path. See GitHub issue #110.
 *
 * Only matches the specific "Failed to load source map" + ENOENT `.js.map`
 * shape; every other warning (including unrelated ENOENT errors against
 * other file extensions) returns `false` so it still surfaces.
 * @public
 */
export function isBenignViteSourceMapWarning(message: string): boolean {
	if (!message) {
		return false;
	}
	return /Failed to load source map/.test(message) && /ENOENT:.*\.js\.map/.test(message);
}
