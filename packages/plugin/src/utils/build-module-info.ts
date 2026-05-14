import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { ModuleInfo } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

interface PackageInfo {
	readonly packageName: string;
	readonly packagePath: string;
}

const NOT_FOUND: PackageInfo = { packageName: "", packagePath: "" };
const cache = new Map<string, PackageInfo>();

const resolvePackageInfo = (filePath: string): PackageInfo => {
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
		if (existsSync(pkgJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: unknown };
				const result: PackageInfo = {
					packageName: typeof pkg.name === "string" ? pkg.name : "",
					packagePath: dir,
				};
				for (const v of visited) cache.set(v, result);
				return result;
			} catch {
				// Malformed JSON — treat as if no package.json and continue walking up.
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
 */
export const buildModuleInfo = (filePath: string): ModuleInfo => {
	const cleanId = filePath.split("?")[0]!;
	const { packageName, packagePath } = resolvePackageInfo(cleanId);
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
