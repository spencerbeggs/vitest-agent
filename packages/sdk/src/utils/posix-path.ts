/**
 * Pure POSIX path helpers for the platform-free core.
 *
 * `@vitest-agent/sdk` must not import `node:path`, so the handful of path
 * operations the core needs are implemented here over normalized
 * forward-slash strings. Every helper accepts Windows-style input (a
 * backslash separator) and normalizes it via {@link toPosix} at entry, so a
 * caller never has to know which separator the platform used.
 */

/**
 * Normalizes `p` to forward slashes: every backslash becomes `/`.
 * @public
 */
export const toPosix = (p: string): string => p.replaceAll("\\", "/");

/**
 * Last segment of `p` after normalization — `"b.ts"` for `"/a/b.ts"`.
 * Trailing separators are ignored, so `"/a/b/"` yields `"b"`.
 * @public
 */
export const basenamePosix = (p: string): string => {
	const normalized = toPosix(p).replace(/\/+$/, "");
	const index = normalized.lastIndexOf("/");
	return index === -1 ? normalized : normalized.slice(index + 1);
};

/**
 * Joins `parts` with a single `/` between each, normalizing every part and
 * collapsing duplicate separators at the seams. Empty parts are skipped.
 * @public
 */
export const joinPosix = (...parts: ReadonlyArray<string>): string => {
	const normalized = parts.map(toPosix).filter((part) => part.length > 0);
	if (normalized.length === 0) return "";
	const [first, ...rest] = normalized;
	return rest.reduce((acc, part) => `${acc.replace(/\/+$/, "")}/${part.replace(/^\/+/, "")}`, first as string);
};

/**
 * Path of `to` relative to `from`, both normalized. Returns `""` when they
 * are the same path and `to` unchanged when it is not under `from` (no
 * `../` climbing — the core has no notion of a filesystem to climb through).
 * @public
 */
export const relativePosix = (from: string, to: string): string => {
	const base = toPosix(from).replace(/\/+$/, "");
	const target = toPosix(to);
	if (target === base) return "";
	const prefix = `${base}/`;
	return target.startsWith(prefix) ? target.slice(prefix.length) : target;
};
