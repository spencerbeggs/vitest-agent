import { basename, dirname, join, relative } from "node:path";
import type { WalkerSyncFileSystem } from "@effected/walker";
import { Walker } from "@effected/walker";
import { nodeWalkerFileSystem } from "@effected/walker/node-sync";
import { Option } from "effect";
import type { ModuleInfo } from "./discover-strategy.js";
import { toPosixPath } from "./to-posix-path.js";

interface PackageInfo {
	readonly packageName: string;
	readonly packagePath: string;
}

/**
 * The one synchronous read the `package.json` walk needs: `@effected/walker`'s
 * port, so a `@effected/memfs` handle's `sync` port and `nodeWalkerFileSystem`
 * both satisfy it. `readFile` answers UTF-8 text and throws on a miss; the walk
 * treats a throw like a malformed manifest and keeps climbing.
 *
 * @internal
 */
export type BuildModuleInfoFs = Pick<WalkerSyncFileSystem, "readFile">;

const NOT_FOUND: PackageInfo = { packageName: "", packagePath: "" };

/**
 * Each directory's verdict, a valid manifest's `name` or none, kept across
 * calls so one tree is read once per directory over the whole run.
 */
const cache = new Map<string, Option.Option<string>>();

/** `dirname(filePath)` and every ancestor up to the root, nearest first. */
const ancestors = (filePath: string): ReadonlyArray<string> => {
	const dirs: string[] = [];
	let dir = dirname(filePath);
	while (true) {
		dirs.push(dir);
		const parent = dirname(dir);
		if (parent === dir) return dirs;
		dir = parent;
	}
};

const resolvePackageInfo = (filePath: string, fs: BuildModuleInfoFs): PackageInfo => {
	const found = Walker.findUpwardSyncWith(
		ancestors(filePath),
		(dir) => {
			try {
				const pkg = JSON.parse(fs.readFile(join(dir, "package.json"))) as { name?: unknown };
				return Option.some(typeof pkg.name === "string" ? pkg.name : "");
			} catch {
				// Absent, unreadable or malformed: not this directory, keep climbing.
				return Option.none();
			}
		},
		{ cache },
	);
	return Option.match(found, {
		onNone: () => NOT_FOUND,
		onSome: ({ dir, value }) => ({ packageName: value, packagePath: dir }),
	});
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
export const buildModuleInfo = (filePath: string, fs: BuildModuleInfoFs = nodeWalkerFileSystem): ModuleInfo => {
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
