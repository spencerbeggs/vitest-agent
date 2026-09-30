import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { WalkerEntryStat, WalkerFileSystem } from "../../src/utils/walker-fs.js";

/**
 * A {@link WalkerFileSystem} over an `@effected/memfs` handle's
 * `node:fs/promises` port — the same `readdir(withFileTypes)` / `stat` calls
 * `nodeWalkerFs` makes against the real disk, so discovery walks run against a
 * seeded virtual tree with node's semantics: literal dirents (a symbolic link
 * answers `false` to both `isFile` and `isDirectory`), and a `stat` that
 * follows links. Seed an mtime with `MemoryFileSystem.file(content, { mtime })`
 * to exercise mtime-fingerprinting walks.
 */
export const memfsWalkerFs = ({ promises }: Pick<MemoryFileSystemHandle, "promises">): WalkerFileSystem => ({
	readDirectory: (dir) => promises.readdir(dir, { withFileTypes: true }),
	statEntry: async (path): Promise<WalkerEntryStat | null> => {
		try {
			const info = await promises.stat(path);
			return { isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs };
		} catch {
			return null;
		}
	},
});

/** Seeds a volume under `root` and returns its walker adapter. */
export const seedMemfsWalker = (root: string, seed: MemoryFileSystemSeed): WalkerFileSystem =>
	memfsWalkerFs(MemoryFileSystem.makeSync(seed, { root }));
