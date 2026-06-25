import { Schema } from "effect";
import { TestRunReason } from "./Common.js";

/**
 * A single project entry in the cache manifest.
 * @public
 */
export const CacheManifestEntry = Schema.Struct({
	project: Schema.String,
	reportFile: Schema.String,
	historyFile: Schema.optional(Schema.String),
	lastRun: Schema.NullOr(Schema.String),
	lastResult: Schema.NullOr(TestRunReason),
}).annotations({ identifier: "CacheManifestEntry" });
/** @public */
export type CacheManifestEntry = typeof CacheManifestEntry.Type;

/**
 * Root manifest file that indexes all project reports.
 * @public
 */
export const CacheManifest = Schema.Struct({
	updatedAt: Schema.String,
	cacheDir: Schema.String,
	projects: Schema.Array(CacheManifestEntry),
}).annotations({ identifier: "CacheManifest" });
/** @public */
export type CacheManifest = typeof CacheManifest.Type;
