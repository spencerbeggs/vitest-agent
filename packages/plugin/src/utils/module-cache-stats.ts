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
 *   cache saved for the next run. Projects share one cache root by default, so
 *   a project's writes are the fresh entries its own manifest
 *   (`_manifest-<label>-<key>.json`, matched by JSON `name` and `root`; Vitest
 *   writes it before the run-end hook) lists in `modules`: a project with no
 *   manifest wrote nothing. Projects sharing a module key both count it, so
 *   the per-project counts can sum to more than the directory holds. An entry is a file named by a 40-hex-digit
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

/** A cache manifest file's name: `_manifest-<label>-<key>.json`. */
const MANIFEST_NAME = /^_manifest-.+\.json$/;

/** The identity Vitest records in a project's manifest: its `config.name` and `config.root`. */
interface ProjectIdentity {
	readonly name: string;
	readonly root: string;
}

/**
 * The cache entry file names a manifest lists, when it belongs to `project`
 * (its JSON `name` and `root` match) and has the expected shape; otherwise
 * `undefined`. Malformed JSON or shape is ignored, never thrown.
 */
function manifestEntries(raw: string, project: ProjectIdentity): ReadonlyArray<string> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const { name, root, modules } = parsed as { name?: unknown; root?: unknown; modules?: unknown };
	if (name !== project.name || root !== project.root) return undefined;
	if (typeof modules !== "object" || modules === null) return undefined;
	const out: string[] = [];
	for (const environment of Object.values(modules)) {
		if (typeof environment !== "object" || environment === null) continue;
		for (const file of Object.values(environment)) if (typeof file === "string") out.push(file);
	}
	return out;
}

/**
 * How many cache entries `project` wrote in the run: files in `dir` named by a
 * cache key, modified at or after `sinceMs` (the run's start), AND listed among
 * the `modules` values of the project's own manifest (`_manifest-*.json`, found
 * by its JSON `name` and `root`). Projects share one cache root by default, so
 * the directory total is not any one project's; the manifest is the only
 * per-project attribution Vitest records. Two projects that share a module key
 * both count it, so the per-project numbers can sum to more than the
 * directory's total. A readable directory with no matching manifest means the
 * project wrote nothing this run: `0`. Reads through the injected `ops`, never
 * `node:fs`. Answers `undefined` when `dir` is missing or unreadable, so
 * "nothing written" and "could not look" stay distinct.
 *
 * @param dir - the resolved cache directory
 * @param sinceMs - the run's start, in epoch milliseconds
 * @param project - the project's `config.name` and `config.root`
 * @param ops - the sync filesystem the walk and manifest reads go through
 * @internal
 */
export function countModulesWritten(
	dir: string,
	sinceMs: number,
	project: ProjectIdentity,
	ops: WalkerSyncOps,
): number | undefined {
	const stats = statOrNull(ops, dir);
	if (stats === null || !stats.isDirectory()) return undefined;
	const entries = descendEntriesSync(DIRECT_CHILDREN, { cwd: dir, onUnreadable: "skip", ...ops });
	if (Result.isFailure(entries)) return undefined;
	const owned = new Set<string>();
	for (const entry of entries.success) {
		if (!MANIFEST_NAME.test(entry.path)) continue;
		let raw: string;
		try {
			raw = ops.fileSystem.readFile(ops.path.join(dir, entry.path));
		} catch {
			continue;
		}
		for (const file of manifestEntries(raw, project) ?? []) owned.add(file);
	}
	return entries.success.filter(
		(entry) => CACHE_ENTRY_NAME.test(entry.path) && entry.info.mtimeMs >= sinceMs && owned.has(entry.path),
	).length;
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
	config?: { fsModuleCache?: unknown; fsModuleCachePath?: unknown; root?: unknown };
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
			const root = project.config?.root;
			const modulesWritten =
				dir === undefined || startMs === undefined || typeof root !== "string"
					? undefined
					: countModulesWritten(dir, startMs, { name, root }, ops);
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
