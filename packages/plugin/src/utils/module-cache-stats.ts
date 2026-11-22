/**
 * Module cache effectiveness per project (issue #741).
 *
 * Vitest exposes no hit or miss counters for its fs module cache
 * (`fsModuleCache`). Two signals are derivable, and both follow vitest@5.1.1:
 *
 * - Time the cache removes: each file task carries `setupFetchDuration` and
 *   `collectFetchDuration` (time spent transforming or serving modules), and
 *   Vitest's own transform diagnostic (`reporters/base.ts`,
 *   `reportTransformDiagnostic`) sums them per project over that project's
 *   tracked time.
 * - Cache writes: each module written to the cache directory is a miss the
 *   cache saved for the next run. An entry is a file named by a 40-hex-digit
 *   sha1 key directly in the cache root (`FileSystemModuleCache.
 *   generateCachePath`); the root also holds `_metadata.json`,
 *   `_manifest-*.json`, `CACHEDIR.TAG` and dot-prefixed temp files, none of
 *   which are entries. Exact hit counts are unavailable and never estimated.
 *
 * @packageDocumentation
 */

import { GlobPattern } from "@effected/glob";
import type { WalkerSyncOps } from "@effected/walker";
import { descendEntriesSync } from "@effected/walker";
import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
import type { ModuleCacheStat } from "@vitest-agent/sdk";
import { Result } from "effect";
import { statOrNull } from "./walker-fs.js";

/** Every direct child of the cache root; dot entries (Vitest's `.tmp-*` files) are skipped by default. */
const DIRECT_CHILDREN = Result.getOrThrow(GlobPattern.compileResult("*"));

/** A cache entry's file name: Vitest's sha1 cache key. */
const CACHE_ENTRY_NAME = /^[0-9a-f]{40}$/;

/**
 * How many cache entries the run wrote: files in `dir` named by a cache key
 * whose modification time is at or after `sinceMs` (the run's start). Reads
 * through the injected `ops`, never `node:fs`. Answers `undefined` when `dir`
 * is missing or unreadable, so "nothing written" and "could not look" stay
 * distinct.
 *
 * @param dir - the resolved cache directory
 * @param sinceMs - the run's start, in epoch milliseconds
 * @param ops - the sync filesystem the walk reads through
 * @internal
 */
export function countModulesWritten(dir: string, sinceMs: number, ops: WalkerSyncOps): number | undefined {
	const stats = statOrNull(ops, dir);
	if (stats === null || !stats.isDirectory()) return undefined;
	const entries = descendEntriesSync(DIRECT_CHILDREN, { cwd: dir, onUnreadable: "skip", ...ops });
	if (Result.isFailure(entries)) return undefined;
	return entries.success.filter((entry) => CACHE_ENTRY_NAME.test(entry.path) && entry.info.mtimeMs >= sinceMs).length;
}

// Structural views of the Vitest objects read here; every field is optional
// and an unknown shape yields no stat.
interface FileLike {
	projectName?: string;
	environmentLoad?: number;
	setupDuration?: number;
	collectDuration?: number;
	collectFetchDuration?: number;
	setupFetchDuration?: number;
	prepareDuration?: number;
	result?: { duration?: number };
}

interface ProjectLike {
	name?: string;
	config?: { fsModuleCache?: unknown; fsModuleCachePath?: unknown };
}

interface VitestLike {
	projects?: ReadonlyArray<ProjectLike>;
	state?: { getFiles?: () => ReadonlyArray<FileLike>; blobs?: unknown };
	cache?: { _modules?: { getCacheRoot?: (config: unknown) => string | null } };
}

/** Summed time of a file's tracked phases (base.ts `trackedFileTime`). */
const trackedFileTime = (file: FileLike): number =>
	(file.environmentLoad || 0) +
	(file.setupDuration || 0) +
	(file.collectDuration || 0) +
	(file.prepareDuration || 0) +
	(file.result?.duration || 0);

/**
 * The directory `project`'s modules are cached in: Vitest's own resolution
 * (`FileSystemModuleCache.getCacheRoot`, which also creates the directory and
 * answers `null` when it cannot) when the instance exposes it, else the
 * project's explicit `fsModuleCachePath`. `undefined` when neither resolves.
 */
const cacheDirOf = (vitest: VitestLike, project: ProjectLike): string | undefined => {
	try {
		const root = vitest.cache?._modules?.getCacheRoot?.(project.config);
		if (typeof root === "string") return root;
	} catch {
		// the cache root is an internal API: fall through to the config value
	}
	const configured = project.config?.fsModuleCachePath;
	return typeof configured === "string" && configured.length > 0 ? configured : undefined;
};

/**
 * Per-project module cache stats for a finished run (issue #741), keyed by
 * project name (`""` for an unnamed project). A project appears only when it
 * has tracked time to report; merged blob reports replay the durations of
 * past runs, so they yield nothing. Never throws.
 *
 * @param vitest - the Vitest instance (read structurally)
 * @param startMs - the run's start, in epoch milliseconds; without it no writes are counted
 * @param ops - the sync filesystem the cache directory is read through
 * @internal
 */
export function collectModuleCacheStats(
	vitest: object,
	startMs: number | undefined,
	ops: WalkerSyncOps = nodeWalkerSyncOps,
): ReadonlyMap<string, ModuleCacheStat> {
	const out = new Map<string, ModuleCacheStat>();
	try {
		const v = vitest as VitestLike;
		if (v.state?.blobs) return out;
		const projects = Array.isArray(v.projects) ? v.projects : [];
		const getFiles = v.state?.getFiles;
		const files = typeof getFiles === "function" ? (getFiles.call(v.state) ?? []) : [];
		for (const project of projects) {
			const name = project.name ?? "";
			let transformMs = 0;
			let trackedMs = 0;
			for (const file of files) {
				if ((file.projectName || "") !== name) continue;
				transformMs += (file.setupFetchDuration || 0) + (file.collectFetchDuration || 0);
				trackedMs += trackedFileTime(file);
			}
			if (trackedMs <= 0) continue;
			const enabled = project.config?.fsModuleCache === true;
			const dir = enabled && startMs !== undefined ? cacheDirOf(v, project) : undefined;
			const modulesWritten =
				dir === undefined || startMs === undefined ? undefined : countModulesWritten(dir, startMs, ops);
			out.set(name, {
				enabled,
				transformMs,
				trackedMs,
				share: transformMs / trackedMs,
				...(modulesWritten !== undefined && { modulesWritten }),
			});
		}
	} catch {
		return new Map();
	}
	return out;
}
