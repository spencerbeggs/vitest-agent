import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "workspaces-effect";
import type { VitestProjectKind } from "./vitest-project.js";
import { VitestProject } from "./vitest-project.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectKindConfig = Partial<NonNullable<TestProjectInlineConfiguration["test"]>>;
export type ProjectKindCallback = (projects: Map<string, VitestProject>) => void | Promise<void>;
export type ProjectKindOverride = ProjectKindConfig | ProjectKindCallback;
export type ProjectsCallback = (ctx: { projects: VitestProject[] }) => void | Promise<void>;
export type DiscoveryOptions =
	| ProjectsCallback
	| { unit?: ProjectKindOverride; int?: ProjectKindOverride; e2e?: ProjectKindOverride };

// ── Process-level cache keyed by workspace root ───────────────────────────────
const _cache = new Map<string, VitestProject[]>();

// ── Filename patterns for test-kind classification ────────────────────────────
const E2E_RE = /\.e2e\.(test|spec)\.(ts|tsx|js|jsx)$/;
const INT_RE = /\.int\.(test|spec)\.(ts|tsx|js|jsx)$/;
const UNIT_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

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

function scanForTestFiles(dir: string): { hasUnit: boolean; hasE2e: boolean; hasInt: boolean } {
	let hasUnit = false,
		hasE2e = false,
		hasInt = false;
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				const sub = scanForTestFiles(join(dir, entry.name));
				hasUnit = hasUnit || sub.hasUnit;
				hasE2e = hasE2e || sub.hasE2e;
				hasInt = hasInt || sub.hasInt;
			} else if (entry.isFile()) {
				if (E2E_RE.test(entry.name)) hasE2e = true;
				else if (INT_RE.test(entry.name)) hasInt = true;
				else if (UNIT_RE.test(entry.name)) hasUnit = true;
			}
			if (hasUnit && hasE2e && hasInt) break;
		}
	} catch {
		/* unreadable dir */
	}
	return { hasUnit, hasE2e, hasInt };
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

async function applyOverrides(projects: VitestProject[], options: DiscoveryOptions): Promise<void> {
	if (typeof options === "function") {
		await options({ projects });
		return;
	}
	const kindOptions: Partial<Record<string, ProjectKindOverride>> = {
		unit: options.unit,
		int: options.int,
		e2e: options.e2e,
	};
	for (const [kind, override] of Object.entries(kindOptions)) {
		if (override === undefined) continue;
		const ofKind = projects.filter((p) => p.kind === kind);
		if (typeof override === "function") {
			const map = new Map<string, VitestProject>();
			for (const p of ofKind) map.set(p.name, p);
			await override(map);
		} else {
			for (const p of ofKind) p.override({ test: override });
		}
	}
}

export async function discoverProjects(options?: DiscoveryOptions, cwd?: string): Promise<VitestProject[]> {
	const root = findWorkspaceRootSync(cwd ?? process.cwd());
	if (!root) {
		throw new Error(
			`[vitest-agent] Could not find workspace root from ${cwd ?? process.cwd()}. ` +
				`Ensure a pnpm-workspace.yaml or package.json with "workspaces" exists.`,
		);
	}

	const cached = _cache.get(root);
	if (cached) return cached;

	const packages = getWorkspacePackagesSync(root);
	const vitestProjects: VitestProject[] = [];

	for (const pkg of packages) {
		// Skip root workspace package
		if (pkg.relativePath === ".") continue;

		const srcDir = join(pkg.path, "src");
		if (!isDir(srcDir)) continue;

		const testDir = join(pkg.path, "__test__");
		const hasTestDir = isDir(testDir);

		const srcScan = scanForTestFiles(srcDir);
		const testScan = hasTestDir ? scanForTestFiles(testDir) : { hasUnit: false, hasE2e: false, hasInt: false };

		const hasUnit = srcScan.hasUnit || testScan.hasUnit;
		const hasE2e = srcScan.hasE2e || testScan.hasE2e;
		const hasInt = srcScan.hasInt || testScan.hasInt;

		const kindCount = [hasUnit, hasE2e, hasInt].filter(Boolean).length;
		const shouldSuffix = kindCount >= 2;

		const srcGlob = `${pkg.relativePath}/src`;
		const testGlob = hasTestDir ? `${pkg.relativePath}/__test__` : null;
		const setupFile = detectSetupFile(pkg.path);
		const setupFiles = setupFile ? [`${pkg.relativePath}/${setupFile}`] : undefined;

		// Exclude helper subdirs inside __test__/ from being picked up as test files
		const testDirExcludes = testGlob ? TEST_DIR_HELPER_DIRS.map((d) => `${testGlob}/${d}/**`) : [];

		const makeProject = (kind: VitestProjectKind, pattern: string, extraExcludes: string[]): VitestProject => {
			const name = shouldSuffix ? `${pkg.name}:${kind}` : pkg.name;
			const factory = kind === "unit" ? VitestProject.unit : kind === "int" ? VitestProject.int : VitestProject.e2e;
			const include = [`${srcGlob}/**/${pattern}`, ...(testGlob ? [`${testGlob}/**/${pattern}`] : [])];
			const exclude = [...extraExcludes, ...testDirExcludes];
			return factory({
				name,
				include,
				overrides: {
					test: {
						...(setupFiles ? { setupFiles } : {}),
						...(exclude.length > 0 ? { exclude } : {}),
					},
				},
			});
		};

		if (hasUnit)
			vitestProjects.push(
				makeProject("unit", "*.{test,spec}.{ts,tsx,js,jsx}", ["**/*.e2e.{test,spec}.*", "**/*.int.{test,spec}.*"]),
			);
		if (hasE2e) vitestProjects.push(makeProject("e2e", "*.e2e.{test,spec}.{ts,tsx,js,jsx}", []));
		if (hasInt) vitestProjects.push(makeProject("int", "*.int.{test,spec}.{ts,tsx,js,jsx}", []));

		if (!hasUnit && !hasE2e && !hasInt) {
			// src/ exists but no test files yet — emit placeholder so package name appears in analytics
			vitestProjects.push(
				makeProject("unit", "*.{test,spec}.{ts,tsx,js,jsx}", ["**/*.e2e.{test,spec}.*", "**/*.int.{test,spec}.*"]),
			);
		}
	}

	if (options) await applyOverrides(vitestProjects, options);

	_cache.set(root, vitestProjects);
	return vitestProjects;
}
