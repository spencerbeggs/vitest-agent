import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";
import type { TestTagDefinition } from "@vitest/runner";
import type { TestProjectInlineConfiguration } from "vitest/config";
import type { DiscoverStrategy } from "./discover-strategy.js";
import { DefaultDiscoverStrategy } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The resolved output of `discoverProjects` — projects and tag definitions ready for `defineConfig`.
 * @public
 */
export interface DiscoverProjectsResult {
	readonly projects: TestProjectInlineConfiguration[] | undefined;
	readonly tags: TestTagDefinition[];
}

/**
 * Options for `discoverProjects`.
 * @public
 */
export interface DiscoverProjectsOptions {
	readonly strategy?: DiscoverStrategy;
	readonly cwd?: string;
	readonly additionalEntries?: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

// ── Cross-package "last scan" handshake (issue #100) ───────────────────────────
// `@vitest-agent/mcp` cannot import this module directly (the plugin package
// declares `@vitest-agent/cli`/`@vitest-agent/mcp` as dependencies, so the
// reverse import would be circular). Both packages instead read/write the
// same process-global slot via `Symbol.for()`, which is guaranteed to resolve
// to the identical symbol across module instances in one process — the same
// technique `ensureMigrated`'s globalThis-keyed promise cache already relies
// on (Decision 28). The MCP server's `run_tests` tool loads `vitest.config.ts`
// in-process via `createVitest`, which calls into this module, so both sides
// observe the same global.
const DISCOVERY_LAST_SCAN_SYMBOL = Symbol.for("vitest-agent:discovery:last-scan-at");

function recordDiscoveryScanTimestamp(): void {
	(globalThis as Record<symbol, unknown>)[DISCOVERY_LAST_SCAN_SYMBOL] = new Date().toISOString();
}

/**
 * Reads the ISO timestamp of the most recent real disk scan performed by
 * `discoverProjects` in this process (cache hits do not update it). Returns
 * `undefined` if no scan has happened yet in this process.
 * @public
 */
export function getLastDiscoveryScanTimestamp(): string | undefined {
	const value = (globalThis as Record<symbol, unknown>)[DISCOVERY_LAST_SCAN_SYMBOL];
	return typeof value === "string" ? value : undefined;
}

// ── Process-level cache keyed by workspace root ───────────────────────────────
// Cache fires only for the no-strategy/no-additionalEntries call path to avoid
// fingerprinting DiscoverStrategy instances. Each entry also carries the
// directory signature (issue #100) that was true at scan time, so a stale
// entry is detected before it's ever returned.
interface CacheEntry {
	readonly result: DiscoverProjectsResult;
	readonly signature: string;
}
const _cache = new Map<string, CacheEntry>();

/**
 * Computes a cheap signature (relative path + mtimeMs pairs, sorted) for every
 * file nested under `dirPath`. Used to detect added/removed/moved/renamed test
 * files between `discoverProjects` calls without re-walking test-file globs.
 * Returns an empty string when `dirPath` does not exist — this still produces
 * a stable, comparable signature contribution.
 */
async function computeDirSignature(dirPath: string): Promise<string> {
	let entries: Dirent[];
	try {
		entries = (await readdir(dirPath, { withFileTypes: true, recursive: true })) as Dirent[];
	} catch {
		return "";
	}
	const parts: string[] = [];
	for (const ent of entries) {
		if (!ent.isFile()) continue;
		const parentPath = (ent as Dirent & { parentPath?: string }).parentPath ?? dirPath;
		const fullPath = join(parentPath, ent.name);
		let mtimeMs: number;
		try {
			mtimeMs = (await stat(fullPath)).mtimeMs;
		} catch {
			// File disappeared mid-walk (race with another process) — skip it;
			// its absence is already reflected by not appearing in `parts`.
			continue;
		}
		const relPath = toPosixPath(relative(dirPath, fullPath));
		parts.push(`${relPath}:${mtimeMs}`);
	}
	parts.sort();
	return parts.join("|");
}

/**
 * Computes a cheap whole-workspace directory signature by combining each
 * package's `src/` and `__test__/` signatures (issue #100). Only entries +
 * mtimes are read — no file content — so this stays fast even for large
 * monorepos. A changed signature means a test file was added, removed,
 * moved, or renamed since the cached result was computed.
 */
async function computeWorkspaceSignature(packages: ReadonlyArray<{ readonly path: string }>): Promise<string> {
	const parts: string[] = [];
	for (const pkg of packages) {
		const srcSig = await computeDirSignature(join(pkg.path, "src"));
		const testDirSig = await computeDirSignature(join(pkg.path, "__test__"));
		parts.push(`${pkg.path}::src=${srcSig}::__test__=${testDirSig}`);
	}
	return parts.join("\n");
}

/**
 * Scan all workspace packages and additional entries through the active strategy and return projects + tags.
 * @param options - Optional strategy, working directory, and extra project entries
 * @returns Resolved projects and tag definitions
 * @public
 */
export async function discoverProjects(options?: DiscoverProjectsOptions): Promise<DiscoverProjectsResult> {
	const strategy = options?.strategy;
	const cwd = options?.cwd;
	const additionalEntries = options?.additionalEntries ?? [];
	const root = findWorkspaceRootSync({ ...nodeSyncOps, cwd: cwd ?? process.cwd() });
	if (!root) {
		throw new Error(
			`[vitest-agent] Could not find workspace root from ${cwd ?? process.cwd()}. ` +
				`Ensure a pnpm-workspace.yaml or package.json with "workspaces" exists.`,
		);
	}

	// Cache only when no strategy and no additionalEntries are passed — the
	// common no-arg path is zero-cost; explicit strategy or added entries bypass
	// the cache because we can't fingerprint DiscoverStrategy instances.
	const useCache = strategy === undefined && additionalEntries.length === 0;
	const resolvedStrategy = strategy ?? new DefaultDiscoverStrategy();
	const packages = getWorkspacePackagesSync(root, nodeSyncOps);

	// Issue #100: a cached result is only valid while the on-disk test-file set
	// it was computed from is unchanged. Compute the cheap directory signature
	// up front (entries + mtimes only — no file content) and compare against
	// the signature captured when the cache entry was written. A mismatch means
	// a test file was added/removed/moved/renamed since the cache was
	// populated, so we fall through and rescan instead of returning stale data.
	let signature: string | undefined;
	if (useCache) {
		signature = await computeWorkspaceSignature(packages);
		const cached = _cache.get(root);
		if (cached && cached.signature === signature) return cached.result;
	}

	const configs: TestProjectInlineConfiguration[] = [];

	// Build lookup sets for conflict detection against workspace packages.
	const workspaceNames = new Set<string>();
	const workspacePaths = new Set<string>();

	for (const pkg of packages) {
		// Unified discovery algorithm §3.6 step 3:
		// strategy.buildProject() decides — null means "skip" (no tests found).
		// No prior filtering on relativePath === "." or !isDir(srcDir).
		// toPosixPath canonicalizes the workspaces-effect relativePath so
		// strategies see the same forward-slash form on Windows.
		const config = await resolvedStrategy.buildProject({
			name: pkg.name,
			path: pkg.path,
			relativePath: toPosixPath(pkg.relativePath),
			workspaceRoot: root,
		});

		if (config !== null) {
			configs.push(config);
		}

		workspaceNames.add(pkg.name);
		workspacePaths.add(normalize(pkg.path));
	}

	// §3.6 step 4-5: process .addProject() entries (additionalEntries).
	for (const entry of additionalEntries) {
		// Resolve path relative to workspace root (spec §7 Q3).
		const absPath = isAbsolute(entry.path) ? entry.path : join(root, entry.path);
		const normPath = normalize(absPath);

		// Conflict detection: name or resolved absolute path collision.
		if (workspaceNames.has(entry.name)) {
			throw new Error(
				`[vitest-agent] .addProject() conflict: name "${entry.name}" already exists as a workspace package. ` +
					`Use a different name or omit the .addProject() call.`,
			);
		}
		if (workspacePaths.has(normPath)) {
			throw new Error(
				`[vitest-agent] .addProject() conflict: resolved path "${normPath}" already exists as a workspace package path. ` +
					`Remove the .addProject() call or adjust the path.`,
			);
		}

		// path.relative handles both POSIX and Windows separators and normalizes
		// trailing slashes on root; toPosixPath then folds Windows backslashes to
		// forward slash so the DiscoverInput.relativePath the strategy sees is
		// canonical across platforms.
		const relativePath = toPosixPath(relative(root, normPath));

		const config = await resolvedStrategy.buildProject({
			name: entry.name,
			path: normPath,
			relativePath,
			workspaceRoot: root,
		});

		// §3.6 step 4: null from buildProject for an added entry → throw.
		if (config === null) {
			const strategyName = resolvedStrategy.constructor.name;
			throw new Error(
				`[vitest-agent] .addProject({ name: "${entry.name}", path: "${entry.path}" }) resolved to path "${normPath}" ` +
					`but ${strategyName} found no test files there. ` +
					`Ensure the directory contains test files matching the strategy's patterns.`,
			);
		}

		configs.push(config);
	}

	// §3.6 step 6: tags from strategy.tagDefinitions
	const tags: TestTagDefinition[] = [...resolvedStrategy.tagDefinitions];

	// §3.6 step 7: if merged projects array is empty, return projects: undefined
	const result: DiscoverProjectsResult = {
		projects: configs.length > 0 ? configs : undefined,
		tags,
	};

	if (useCache && signature !== undefined) _cache.set(root, { result, signature });
	recordDiscoveryScanTimestamp();
	return result;
}
