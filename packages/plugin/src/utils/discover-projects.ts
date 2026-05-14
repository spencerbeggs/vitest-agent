import { isAbsolute, join, normalize, relative } from "node:path";
import type { TestTagDefinition } from "@vitest/runner";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "workspaces-effect";
import type { DiscoverStrategy } from "./discover-strategy.js";
import { DefaultDiscoverStrategy } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscoverProjectsResult {
	readonly projects: TestProjectInlineConfiguration[] | undefined;
	readonly tags: TestTagDefinition[];
}

export interface DiscoverProjectsOptions {
	readonly strategy?: DiscoverStrategy;
	readonly cwd?: string;
	readonly additionalEntries?: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

// ── Process-level cache keyed by workspace root ───────────────────────────────
// Cache fires only for the no-strategy/no-additionalEntries call path to avoid
// fingerprinting DiscoverStrategy instances.
const _cache = new Map<string, DiscoverProjectsResult>();

export async function discoverProjects(options?: DiscoverProjectsOptions): Promise<DiscoverProjectsResult> {
	const strategy = options?.strategy;
	const cwd = options?.cwd;
	const additionalEntries = options?.additionalEntries ?? [];
	const root = findWorkspaceRootSync(cwd ?? process.cwd());
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
	if (useCache) {
		const cached = _cache.get(root);
		if (cached) return cached;
	}

	const resolvedStrategy = strategy ?? new DefaultDiscoverStrategy();
	const packages = getWorkspacePackagesSync(root);
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

	if (useCache) _cache.set(root, result);
	return result;
}
