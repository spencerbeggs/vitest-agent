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

// Directories every signature-computing walk in this module (both the
// nested-`__test__`-dir finder and the per-directory mtime signature itself)
// prunes before recursing into them. Node's recursive `readdir` follows
// symlinked directories, and pnpm workspace packages' `node_modules` trees
// are full of them (each dependency is a symlink into the content-addressed
// store) — an unguarded walk from a package root, or from a found `__test__`
// dir that happens to contain a fixture `node_modules` (e.g. a
// subprocess-e2e fixture that installs its own deps), would recurse through
// the entire store or hit a symlink cycle. Pruning before recursing, not
// filtering results after, is what makes this safe.
const SIGNATURE_SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

// Deliberate asymmetry with `find-test-files.ts`: `findTestFiles` stops at a
// nested `package.json` boundary (a directory other than its own root that
// declares one is treated as an independent unit and not walked into), but
// neither `findNestedTestDirs` nor `walkDirSignature` here stops — they only
// prune `SIGNATURE_SKIP_DIRS`. That means a fixture package's own
// `__test__/` dir (e.g. a subprocess-e2e fixture with its own package.json)
// is over-included in the signature even though `findTestFiles` would never
// walk into it for actual test-file discovery. This is intentional: the
// signature only decides whether the cache re-scans, so over-including
// fails safe toward re-scanning too often, never toward serving a stale
// project list. The walk does, however, RECORD every nested `package.json`
// (path + mtime) as a boundary marker in the signature — adding or removing
// one changes `findTestFiles`' traversal shape without touching any test
// file, and the cache must re-scan for that too.

/**
 * The result of one nested scan: every directory named `__test__` under the
 * root, plus every nested `package.json` boundary marker (`relPath:mtimeMs`).
 * Boundaries matter because `findTestFiles` stops its walk at a nested
 * `package.json` — adding or removing one changes which test files discovery
 * can see, so the cache signature must change with it.
 */
interface NestedScan {
	readonly testDirs: string[];
	readonly boundaries: string[];
}

/**
 * Recursively finds every directory named `__test__` under `root` (issue
 * #184: nested `__test__` dirs like `lib/scripts/__test__/` must invalidate
 * the cache too, not just a package-root `__test__/`) and records every
 * nested `package.json` (path + mtime) as a traversal-boundary marker. Skips
 * `node_modules`, `.git`, and `dist` — see `SIGNATURE_SKIP_DIRS`. Stat-only:
 * entries and mtimes are read, never file content. The root's own
 * `package.json` is excluded — it is not a boundary for its own walk, and
 * version bumps would otherwise churn the signature.
 */
async function findNestedTestDirs(root: string): Promise<NestedScan> {
	const testDirs: string[] = [];
	const boundaries: string[] = [];
	await walkForTestDirs(root, root, testDirs, boundaries);
	return { testDirs: testDirs.sort(), boundaries: boundaries.sort() };
}

async function walkForTestDirs(root: string, dir: string, testDirs: string[], boundaries: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
	} catch {
		return;
	}
	for (const ent of entries) {
		const fullPath = join(dir, ent.name);
		if (ent.isDirectory()) {
			if (SIGNATURE_SKIP_DIRS.has(ent.name)) continue;
			if (ent.name === "__test__") testDirs.push(fullPath);
			await walkForTestDirs(root, fullPath, testDirs, boundaries);
		} else if (ent.isFile() && ent.name === "package.json" && dir !== root) {
			try {
				const mtimeMs = (await stat(fullPath)).mtimeMs;
				boundaries.push(`${toPosixPath(relative(root, fullPath))}:${mtimeMs}`);
			} catch {
				// File disappeared mid-walk — its absence is the signal.
			}
		}
	}
}

/**
 * Computes a cheap signature (relative path + mtimeMs pairs, sorted) for every
 * file nested under `dirPath`. Used to detect added/removed/moved/renamed test
 * files between `discoverProjects` calls without re-walking test-file globs.
 * Returns an empty string when `dirPath` does not exist — this still produces
 * a stable, comparable signature contribution.
 *
 * Manual per-directory walk (not a single `readdir({ recursive: true })`
 * call) pruning `SIGNATURE_SKIP_DIRS` *before* recursing — same reasoning as
 * `findNestedTestDirs`: a found `__test__` dir can itself contain a fixture
 * `node_modules` (e.g. a subprocess-e2e fixture that installs deps), and
 * Node's recursive `readdir` follows symlinked directories, so an unguarded
 * call would walk into it.
 */
async function computeDirSignature(dirPath: string): Promise<string> {
	const parts: string[] = [];
	await walkDirSignature(dirPath, dirPath, parts);
	parts.sort();
	return parts.join("|");
}

async function walkDirSignature(root: string, dir: string, parts: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
	} catch {
		return;
	}
	for (const ent of entries) {
		const fullPath = join(dir, ent.name);
		if (ent.isDirectory()) {
			if (SIGNATURE_SKIP_DIRS.has(ent.name)) continue;
			await walkDirSignature(root, fullPath, parts);
		} else if (ent.isFile()) {
			let mtimeMs: number;
			try {
				mtimeMs = (await stat(fullPath)).mtimeMs;
			} catch {
				// File disappeared mid-walk (race with another process) — skip it;
				// its absence is already reflected by not appearing in `parts`.
				continue;
			}
			const relPath = toPosixPath(relative(root, fullPath));
			parts.push(`${relPath}:${mtimeMs}`);
		}
	}
}

/**
 * Computes a cheap whole-workspace directory signature by combining each
 * package's `src/` signature with every nested `__test__/` dir's signature
 * (issue #100, extended by issue #184 to see `__test__` dirs at any depth,
 * not just a package-root `__test__/`). Only entries + mtimes are read — no
 * file content — so this stays fast even for large monorepos. A changed
 * signature means a test file was added, removed, moved, or renamed since
 * the cached result was computed.
 */
async function computeWorkspaceSignature(packages: ReadonlyArray<{ readonly path: string }>): Promise<string> {
	const parts: string[] = [];
	for (const pkg of packages) {
		const srcSig = await computeDirSignature(join(pkg.path, "src"));
		const { testDirs, boundaries } = await findNestedTestDirs(pkg.path);
		const testDirParts: string[] = [];
		for (const dir of testDirs) {
			const sig = await computeDirSignature(dir);
			testDirParts.push(`${toPosixPath(relative(pkg.path, dir))}=${sig}`);
		}
		// Boundary markers: nested package.json files change findTestFiles'
		// traversal shape, so their appearance/removal/mtime is part of the
		// signature even when no test file changed.
		parts.push(`${pkg.path}::src=${srcSig}::__test__=${testDirParts.join(";")}::boundaries=${boundaries.join(";")}`);
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
	const root = findWorkspaceRootSync(cwd ?? process.cwd(), nodeSyncOps);
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
