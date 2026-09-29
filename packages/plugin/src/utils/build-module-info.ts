import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { ModuleInfo } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

interface PackageInfo {
	readonly packageName: string;
	readonly packagePath: string;
}

/**
 * The two synchronous filesystem reads the `package.json` walk needs.
 *
 * @remarks
 * Shaped as the `node:fs` sync subset (`existsSync`, `readFileSync(p, "utf8")`)
 * so `@effected/memfs`'s `MemoryFileSystem.syncFileSystem(volume)` satisfies
 * it structurally. `readFile` returns UTF-8 text and may throw on a miss; the
 * walk treats a throw like a malformed manifest and keeps climbing.
 *
 * @internal
 */
export interface BuildModuleInfoFs {
	readonly exists: (path: string) => boolean;
	readonly readFile: (path: string) => string;
}

const nodeBuildModuleInfoFs: BuildModuleInfoFs = {
	exists: (path) => existsSync(path),
	readFile: (path) => readFileSync(path, "utf8"),
};

const NOT_FOUND: PackageInfo = { packageName: "", packagePath: "" };
const cache = new Map<string, PackageInfo>();

const resolvePackageInfo = (filePath: string, fs: BuildModuleInfoFs): PackageInfo => {
	let dir = dirname(filePath);
	const visited: string[] = [];

	while (true) {
		const cached = cache.get(dir);
		if (cached !== undefined) {
			for (const v of visited) cache.set(v, cached);
			return cached;
		}

		visited.push(dir);

		const pkgJsonPath = `${dir}/package.json`;
		if (fs.exists(pkgJsonPath)) {
			try {
				const pkg = JSON.parse(fs.readFile(pkgJsonPath)) as { name?: unknown };
				const result: PackageInfo = {
					packageName: typeof pkg.name === "string" ? pkg.name : "",
					packagePath: dir,
				};
				for (const v of visited) cache.set(v, result);
				return result;
			} catch {
				// Malformed JSON or an unreadable file — treat as if no package.json and continue walking up.
			}
		}

		const parent = dirname(dir);
		if (parent === dir) {
			// Reached filesystem root without finding a valid package.json
			for (const v of visited) cache.set(v, NOT_FOUND);
			return NOT_FOUND;
		}
		dir = parent;
	}
};

/**
 * Build a {@link ModuleInfo} for the given file path by walking up the
 * directory tree to locate the nearest `package.json`. Results are cached
 * per directory so the walk runs at most once per workspace package across
 * the whole test run.
 *
 * Query strings (Vite virtual module suffixes like `?v=1234`) are stripped
 * before the walk so the cache key is always a clean filesystem path.
 *
 * @param filePath - Module id, optionally carrying a Vite query suffix.
 * @param fs - Filesystem the `package.json` walk reads through. Defaults to
 *   `node:fs`; tests pass a virtual volume. The cache is shared across ports
 *   and keyed only by directory, so a test injecting a volume should use
 *   roots no other caller walks, or call {@link clearBuildModuleInfoCache}.
 */
export const buildModuleInfo = (filePath: string, fs: BuildModuleInfoFs = nodeBuildModuleInfoFs): ModuleInfo => {
	const queryIndex = filePath.indexOf("?");
	const cleanId = queryIndex === -1 ? filePath : filePath.slice(0, queryIndex);
	const { packageName, packagePath } = resolvePackageInfo(cleanId, fs);
	return {
		path: cleanId,
		// Canonical forward-slash form so downstream classifiers and the
		// bundled classifyByDirectory helper match consistently on Windows.
		relativePath: toPosixPath(relative(process.cwd(), cleanId)),
		filename: basename(cleanId),
		packageName,
		packagePath,
	};
};

/**
 * Clear the internal directory→package cache. Intended for use in tests
 * to keep test runs hermetic.
 */
export const clearBuildModuleInfoCache = (): void => {
	cache.clear();
};
