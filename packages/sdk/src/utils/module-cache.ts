import type { ModuleCacheEntry, ModuleCacheStat } from "../schemas/ModuleCache.js";

/** Milliseconds as `250ms` under a second, else seconds to one decimal with a trailing `.0` dropped. */
const formatMs = (ms: number): string => {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = Math.round(ms / 100) / 10;
	return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
};

/**
 * A module cache stat as `on · transform 1.2s (2%) · 14 modules written`: the
 * text after the `Module cache: ` label. The written count is left out when it
 * is unknown.
 *
 * @param stat - the project's module cache stat
 * @returns the description
 * @public
 */
export const describeModuleCache = (stat: ModuleCacheStat): string => {
	const parts = [
		stat.enabled ? "on" : "off",
		`transform ${formatMs(stat.transformMs)} (${Math.round(stat.share * 100)}%)`,
	];
	if (stat.modulesWritten !== undefined) {
		parts.push(`${stat.modulesWritten} ${stat.modulesWritten === 1 ? "module" : "modules"} written`);
	}
	return parts.join(" · ");
};

/**
 * The one-line module-cache summary every renderer shares (issue #741), e.g.
 * `Module cache: on · transform 1.2s (2%) · 14 modules written`. The written
 * count is left out when it is unknown.
 *
 * @param stat - the project's module cache stat
 * @returns the line
 * @public
 */
export const formatModuleCacheLine = (stat: ModuleCacheStat): string => `Module cache: ${describeModuleCache(stat)}`;

/**
 * The module-cache lines for a run: one per project with data, in order. A
 * lone entry is unprefixed; with several each line is prefixed by its project
 * (`default` for an unnamed one). Empty when no project has data.
 *
 * @param entries - the per-project entries from the render state
 * @returns the lines
 * @public
 */
export const formatModuleCacheLines = (entries: ReadonlyArray<ModuleCacheEntry> | undefined): ReadonlyArray<string> => {
	if (entries === undefined || entries.length === 0) return [];
	return entries.map((entry) => {
		const line = formatModuleCacheLine(entry.moduleCache);
		return entries.length > 1 ? `${entry.project ?? "default"}: ${line}` : line;
	});
};
