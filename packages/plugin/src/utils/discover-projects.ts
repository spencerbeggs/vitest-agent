import { isAbsolute, join, normalize, relative } from "node:path";
import type { WalkerSyncOps } from "@effected/walker";
import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
import type { GetWorkspacePackagesSyncOptions } from "@effected/workspaces";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import type { WorkspacesSyncOptions } from "@effected/workspaces/node-sync";
import { nodeSyncOps } from "@effected/workspaces/node-sync";
import { SRC_DIR, TEST_DIR } from "@vitest-agent/sdk";
import type { TestProjectInlineConfiguration, TestTagDefinition } from "vitest/config";
import type { DiscoverStrategy } from "./discover-strategy.js";
import { DefaultDiscoverStrategy } from "./discover-strategy.js";
import { directorySignature } from "./find-test-files.js";
import { isTestShapedPackage } from "./is-test-shaped-package.js";
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
	/**
	 * Sync filesystem the test-file and signature walks read through
	 * (`@effected/walker`'s `WalkerSyncOps`). Defaults to its
	 * `nodeWalkerSyncOps`; tests inject a virtual volume instead of a real tmp
	 * tree.
	 */
	readonly fs?: WalkerSyncOps;
	/**
	 * Sync operations `@effected/workspaces` resolves the workspace root and
	 * package list through. Defaults to its `nodeSyncOps` binding.
	 */
	readonly syncOps?: WorkspacesSyncOptions;
	/**
	 * Optional traversal depth override for workspace package enumeration.
	 * Forwarded to `@effected/workspaces`' `getWorkspacePackagesSync`.
	 */
	readonly maxDepth?: number;
	/**
	 * Per-project `test` overrides keyed by project name (the workspace
	 * package name, or an `additionalEntries` name). Each value is shallow-merged
	 * over the generated project's `test` block after the strategy has built it;
	 * `name` is never replaced. A key naming no discovered project throws, so a
	 * typo cannot silently leave a project on its defaults. Supplying this
	 * bypasses the process-level result cache.
	 */
	readonly configure?: ProjectConfigureMap;
}

/**
 * The Vitest `test` fields a `configure` entry may set on one generated
 * project — everything Vitest accepts on a project's inline `test` block
 * except `name`, which stays the discovered project's own.
 *
 * @remarks
 * The typical use is pool scheduling per project: `{ isolate: false }` for a
 * package whose suites share no module-level state, while a package that
 * spawns processes or calls `process.chdir()` keeps the root's forks plus
 * isolation (issue #626). The merge is shallow: an `include` or `exclude` here
 * replaces the strategy's list rather than appending to it.
 * @public
 */
export type ProjectTestOverrides = Omit<NonNullable<TestProjectInlineConfiguration["test"]>, "name">;

/**
 * Project name to {@link ProjectTestOverrides}, as passed to `configure`.
 * @public
 */
export type ProjectConfigureMap = Readonly<Record<string, ProjectTestOverrides>>;

/**
 * Shallow-merges each `overrides` entry into the generated project whose
 * `test.name` equals the entry's key. Pure: returns new project objects for the
 * configured names and the original objects for the rest; the discovered
 * `name` always wins over one carried by the override. Only a string
 * `test.name` can be keyed; a project named through Vitest's object form is
 * left untouched (and a key for it is reported as unknown).
 *
 * Throws when a key names no project in `configs`, listing the discovered
 * names so the typo is visible at config-load time.
 * @param configs - The projects a strategy produced
 * @param overrides - Per-project `test` overrides keyed by project name
 * @returns The projects with overrides applied
 * @public
 */
export function applyProjectOverrides(
	configs: ReadonlyArray<TestProjectInlineConfiguration>,
	overrides: ProjectConfigureMap,
): TestProjectInlineConfiguration[] {
	const names = new Set(configs.map((c) => c.test?.name).filter((n): n is string => typeof n === "string"));
	const unknown = Object.keys(overrides).filter((key) => !names.has(key));
	if (unknown.length > 0) {
		const quoted = unknown.map((k) => `"${k}"`).join(", ");
		const discovered = [...names].map((n) => `"${n}"`).join(", ") || "(none)";
		throw new Error(
			`[vitest-agent] configure: ${quoted} ${unknown.length === 1 ? "matches" : "match"} no discovered project. ` +
				`Discovered projects: ${discovered}.`,
		);
	}
	return configs.map((config) => {
		const name = config.test?.name;
		if (typeof name !== "string" || !Object.hasOwn(overrides, name)) return config;
		return { ...config, test: { ...config.test, ...overrides[name], name } };
	});
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

// ── Declined-package warning (issue #229) ──────────────────────────────────────
// `strategy.buildProject` returning null for a workspace package is silent by
// contract — most packages legitimately have no tests, and warning on every one
// would be pure noise. But when the package LOOKS test-shaped (a `__test__/`
// directory exists, or `src/` holds files matching the discoverable test-file
// naming convention) and still got declined, that is the "forgot the .test.
// suffix" / "empty __test__/ dir" mistake a consumer without the Claude Code
// plugin's PreToolUse hooks would otherwise never learn about — their tests
// silently never run or persist. Module-level (not per-call) so a package is
// warned about at most once per process, regardless of how many times
// `discoverProjects` re-resolves it (Vite can invoke `configureVitest` — and
// therefore a fresh `AgentPlugin.discover()` — once per project in a
// multi-project config).
const warnedDeclinedPackagePaths = new Set<string>();

async function warnIfDeclinedPackageIsTestShaped(
	pkg: { readonly name: string; readonly path: string },
	fs: WalkerSyncOps,
): Promise<void> {
	const normPath = normalize(pkg.path);
	if (warnedDeclinedPackagePaths.has(normPath)) return;
	// Reserve the path BEFORE the async probe, not after: two overlapping
	// `discoverProjects()` calls (the MCP server re-resolving discovery while a
	// Vitest config load is in flight) would otherwise both clear the `has()`
	// guard while the first is still awaiting `isTestShapedPackage`, and both
	// would warn. The reservation is released again when the package turns out
	// not to be test-shaped, so a later run can still warn if it becomes one.
	warnedDeclinedPackagePaths.add(normPath);
	let testShaped: boolean;
	try {
		testShaped = await isTestShapedPackage(pkg.path, fs);
	} catch (error) {
		warnedDeclinedPackagePaths.delete(normPath);
		throw error;
	}
	if (!testShaped) {
		warnedDeclinedPackagePaths.delete(normPath);
		return;
	}
	process.stderr.write(
		`[vitest-agent] warning: package "${pkg.name}" has a ${TEST_DIR}/ directory or ${SRC_DIR}/ test files, ` +
			`but its tests were not wired into a Vitest project. ` +
			`Run \`npx vitest-agent agent check-test-path <path>\` to diagnose why.\n`,
	);
}

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
 * Computes a cheap whole-workspace directory signature from each package's
 * `src/` and `__test__/` directories (issue #100). Only entries + mtimes are
 * read — no file content — so this stays fast for large monorepos. A changed
 * signature means a test file was added, removed, moved, or renamed since
 * the cached result was computed.
 *
 * Each directory's signature is composed from the stats
 * `@effected/walker`'s `descendEntriesSync` already read (relative path plus
 * mtimeMs per file), with the same prune and symlink rules as the test-file
 * walk.
 *
 * Only the two anchored directories are fingerprinted. Discovery cannot see a
 * test file anywhere else, so nothing else can change the emitted project list
 * (issue #227).
 */
function computeWorkspaceSignature(packages: ReadonlyArray<{ readonly path: string }>, fs: WalkerSyncOps): string {
	const parts: string[] = [];
	for (const pkg of packages) {
		const srcSig = directorySignature(join(pkg.path, SRC_DIR), fs);
		const testSig = directorySignature(join(pkg.path, TEST_DIR), fs);
		parts.push(`${pkg.path}::src=${srcSig}::__test__=${testSig}`);
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
	const configure = options?.configure;
	const fs = options?.fs ?? nodeWalkerSyncOps;
	const syncOps = options?.syncOps ?? nodeSyncOps;
	const packageEnumerationOptions: GetWorkspacePackagesSyncOptions = {
		...syncOps,
		...(options?.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
	};
	const root = findWorkspaceRootSync(cwd ?? process.cwd(), syncOps);
	if (!root) {
		throw new Error(
			`[vitest-agent] Could not find workspace root from ${cwd ?? process.cwd()}. ` +
				`Ensure a pnpm-workspace.yaml or package.json with "workspaces" exists.`,
		);
	}

	// Cache only when no strategy, no additionalEntries and no configure map are
	// passed — the common no-arg path is zero-cost; explicit strategy, added
	// entries or overrides bypass the cache because we can't fingerprint
	// DiscoverStrategy instances (or cheaply the override objects).
	const useCache = strategy === undefined && additionalEntries.length === 0 && configure === undefined;
	const resolvedStrategy = strategy ?? new DefaultDiscoverStrategy();
	// @effected/workspaces defaults `maxDepth` to 32; this explicit option is
	// what enables consumers to traverse deeper workspace layouts when needed.
	const packages = getWorkspacePackagesSync(root, packageEnumerationOptions);

	// Issue #100: a cached result is only valid while the on-disk test-file set
	// it was computed from is unchanged. Compute the cheap directory signature
	// up front (entries + mtimes only — no file content) and compare against
	// the signature captured when the cache entry was written. A mismatch means
	// a test file was added/removed/moved/renamed since the cache was
	// populated, so we fall through and rescan instead of returning stale data.
	let signature: string | undefined;
	if (useCache) {
		signature = computeWorkspaceSignature(packages, fs);
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
			fs,
		});

		if (config !== null) {
			configs.push(config);
		} else {
			await warnIfDeclinedPackageIsTestShaped(pkg, fs);
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
			fs,
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

	// Issue #626: layer the caller's per-project `test` overrides onto the
	// generated projects (workspace packages and added entries alike).
	const configured = configure === undefined ? configs : applyProjectOverrides(configs, configure);

	// §3.6 step 7: if merged projects array is empty, return projects: undefined
	const result: DiscoverProjectsResult = {
		projects: configured.length > 0 ? configured : undefined,
		tags,
	};

	if (useCache && signature !== undefined) _cache.set(root, { result, signature });
	recordDiscoveryScanTimestamp();
	return result;
}
