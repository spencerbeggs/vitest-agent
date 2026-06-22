import type { PackageManager } from "../schemas/Common.js";

/**
 * Filesystem abstraction for package manager detection.
 *
 * @remarks
 * This interface allows dependency injection for testability. In production,
 * pass an adapter backed by `node:fs/promises`. In tests, provide a mock
 * implementation.
 *
 * @example
 * ```typescript
 * import type { FileSystemAdapter } from "@vitest-agent/sdk/detect-pm";
 * import { readFile, access } from "node:fs/promises";
 *
 * const fsAdapter: FileSystemAdapter = {
 *   readFile: (path: string) => readFile(path, "utf-8"),
 *   exists: async (path: string) => {
 *     try {
 *       await access(path);
 *       return true;
 *     } catch {
 *       return false;
 *     }
 *   },
 * };
 * ```
 *
 * @internal
 */
export interface FileSystemAdapter {
	readFile(path: string): Promise<string>;
	exists(path: string): Promise<boolean>;
}

const LOCKFILE_MAP: [string, PackageManager][] = [
	["pnpm-lock.yaml", "pnpm"],
	["package-lock.json", "npm"],
	["yarn.lock", "yarn"],
	["bun.lock", "bun"],
];

const RUN_COMMANDS: Record<PackageManager, string> = {
	pnpm: "pnpm vitest run",
	npm: "npx vitest run",
	yarn: "yarn vitest run",
	bun: "bun vitest run",
};

/**
 * Detect the package manager used in a project by inspecting the root directory.
 *
 * @remarks
 * Detection order:
 * 1. The `packageManager` field in `package.json` (e.g., `"pnpm\@10.32.1"`)
 * 2. Lockfile presence: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`
 *
 * Returns `null` when no package manager can be determined.
 *
 * @param root - Absolute path to the project root directory
 * @param fs - Filesystem adapter for reading files and checking existence
 * @returns The detected package manager, or `null`
 *
 * @internal
 */
export async function detectPackageManager(root: string, fs: FileSystemAdapter): Promise<PackageManager | null> {
	try {
		const raw = await fs.readFile(`${root}/package.json`);
		const pkg = JSON.parse(raw) as { packageManager?: string };
		if (pkg.packageManager) {
			const name = pkg.packageManager.split("@")[0] as PackageManager;
			if (name in RUN_COMMANDS) return name;
		}
	} catch {
		/* fall through */
	}

	for (const [lockfile, pm] of LOCKFILE_MAP) {
		if (await fs.exists(`${root}/${lockfile}`)) return pm;
	}

	return null;
}

/**
 * Return the vitest run command for the given package manager.
 *
 * Falls back to `"npx vitest run"` when `pm` is `null`.
 *
 * @param pm - Detected package manager, or `null` for unknown
 * @returns Shell command string for running vitest
 *
 * @internal
 */
export function getRunCommand(pm: PackageManager | null): string {
	if (!pm) return "npx vitest run";
	return RUN_COMMANDS[pm];
}
