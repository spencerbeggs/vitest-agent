import { Schema } from "effect";
import { FiniteNumber } from "./Common.js";

/**
 * How well Vitest's fs module cache (`fsModuleCache`) served one project's
 * run (issue #741).
 *
 * Vitest exposes no hit or miss counters, so the figures are derived:
 * `transformMs` sums each file's `setupFetchDuration + collectFetchDuration`
 * (the time spent transforming and serving modules, which a warm cache
 * removes), `trackedMs` is the project's tracked file time (the denominator
 * of Vitest's own transform diagnostic) and `share` is their ratio.
 * `modulesWritten` counts cache entries written during the run (files in the
 * resolved cache directory modified since the run started): each is a miss
 * the cache saved for the next run. Exact hit counts are not available and
 * are never estimated. Omitted from a report when the run produced no timing
 * data.
 * @public
 */
export const ModuleCacheStat = Schema.Struct({
	/** Whether `fsModuleCache` was enabled for the project. */
	enabled: Schema.Boolean,
	/** Summed `setupFetchDuration + collectFetchDuration`, in milliseconds. */
	transformMs: FiniteNumber,
	/** The project's tracked file time, in milliseconds. */
	trackedMs: FiniteNumber,
	/** `transformMs / trackedMs`; `0` when no time was tracked. */
	share: FiniteNumber,
	/** Cache entries written during the run; absent when the directory could not be read or the cache is off. */
	modulesWritten: Schema.optional(FiniteNumber),
}).annotate({ identifier: "ModuleCacheStat" });
/** @public */
export type ModuleCacheStat = typeof ModuleCacheStat.Type;

/**
 * One project's {@link (ModuleCacheStat:type)}, as `RunFinished` carries it into the
 * render state. `project` is omitted for a single-project run.
 * @public
 */
export const ModuleCacheEntry = Schema.Struct({
	project: Schema.optional(Schema.String),
	moduleCache: ModuleCacheStat,
}).annotate({ identifier: "ModuleCacheEntry" });
/** @public */
export type ModuleCacheEntry = typeof ModuleCacheEntry.Type;
