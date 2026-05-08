import { statSync } from "node:fs";
import { join } from "node:path";
import type { TestTagDefinition } from "@vitest/runner";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "workspaces-effect";
import { TagStrategy } from "./tag-strategy.js";
import { VitestProject } from "./vitest-project.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectsCallback = (ctx: { projects: VitestProject[] }) => void | Promise<void>;
export type DiscoveryOptions =
	| ProjectsCallback
	| {
			callback?: ProjectsCallback;
			tagStrategy?: TagStrategy | false;
	  };

export interface DiscoverProjectsResult {
	projects: VitestProject[];
	tags: TestTagDefinition[];
}

// ── Process-level cache keyed by workspace root ───────────────────────────────
// Cache fires only for the no-options call path to avoid fingerprinting
// TagStrategy instances.
const _cache = new Map<string, DiscoverProjectsResult>();

const SETUP_EXTS = ["ts", "tsx", "js", "jsx"] as const;

// Subdirs under __test__/ that hold helpers, not test files
const TEST_DIR_HELPER_DIRS = ["utils", "fixtures", "snapshots"];

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function detectSetupFile(pkgPath: string): string | null {
	for (const ext of SETUP_EXTS) {
		const candidate = join(pkgPath, `vitest.setup.${ext}`);
		try {
			if (statSync(candidate).isFile()) return `vitest.setup.${ext}`;
		} catch {}
	}
	return null;
}

function resolveOptions(options: DiscoveryOptions | undefined): {
	callback: ProjectsCallback | undefined;
	strategy: TagStrategy | false;
} {
	if (options === undefined) return { callback: undefined, strategy: TagStrategy.default };
	if (typeof options === "function") return { callback: options, strategy: TagStrategy.default };
	const strategy = options.tagStrategy === undefined ? TagStrategy.default : options.tagStrategy;
	return { callback: options.callback, strategy };
}

export async function discoverProjects(options?: DiscoveryOptions, cwd?: string): Promise<DiscoverProjectsResult> {
	const root = findWorkspaceRootSync(cwd ?? process.cwd());
	if (!root) {
		throw new Error(
			`[vitest-agent] Could not find workspace root from ${cwd ?? process.cwd()}. ` +
				`Ensure a pnpm-workspace.yaml or package.json with "workspaces" exists.`,
		);
	}

	// Cache only when no options are passed — keeps the API zero-cost for the
	// common case (a Vitest config with no override) without trying to fingerprint
	// a TagStrategy instance.
	if (options === undefined) {
		const cached = _cache.get(root);
		if (cached) return cached;
	}

	const { callback, strategy } = resolveOptions(options);

	const packages = getWorkspacePackagesSync(root);
	const vitestProjects: VitestProject[] = [];

	for (const pkg of packages) {
		// Skip root workspace package
		if (pkg.relativePath === ".") continue;

		const srcDir = join(pkg.path, "src");
		if (!isDir(srcDir)) continue;

		const testDir = join(pkg.path, "__test__");
		const hasTestDir = isDir(testDir);

		const srcGlob = `${pkg.relativePath}/src`;
		const testGlob = hasTestDir ? `${pkg.relativePath}/__test__` : null;
		const setupFile = detectSetupFile(pkg.path);
		const setupFiles = setupFile ? [`${pkg.relativePath}/${setupFile}`] : undefined;

		// Exclude helper subdirs inside __test__/ from being picked up as test files
		const testDirExcludes = testGlob ? TEST_DIR_HELPER_DIRS.map((d) => `${testGlob}/${d}/**`) : [];

		const include = [
			`${srcGlob}/**/*.{test,spec}.{ts,tsx,js,jsx}`,
			...(testGlob ? [`${testGlob}/**/*.{test,spec}.{ts,tsx,js,jsx}`] : []),
		];

		const project = VitestProject.unit({
			name: pkg.name,
			include,
			overrides: {
				test: {
					...(setupFiles ? { setupFiles } : {}),
					...(testDirExcludes.length > 0 ? { exclude: testDirExcludes } : {}),
				} as Partial<NonNullable<TestProjectInlineConfiguration["test"]>>,
			},
		});

		vitestProjects.push(project);
	}

	if (callback) await callback({ projects: vitestProjects });

	const tags: TestTagDefinition[] = strategy === false ? [] : [...strategy.tagDefinitions];

	const result: DiscoverProjectsResult = { projects: vitestProjects, tags };
	if (options === undefined) _cache.set(root, result);
	return result;
}
