import * as path from "node:path";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed, MemoryFileSystemSyncFileSystem } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { uniqueRoot } from "./memfs-workspace.js";

/**
 * A seeded `@effected/memfs` volume presented through its node-shaped sync
 * port, for production seams that take a synchronous `node:fs` subset.
 */
export interface MemfsSync {
	/** Absolute root the seed was placed under. */
	readonly root: string;
	readonly fs: MemoryFileSystemSyncFileSystem;
	/** Faulted ports over the same volume. */
	readonly withFaults: MemoryFileSystemHandle["withFaults"];
	/** `root` joined with `segments`, POSIX-style (the volume's separator). */
	readonly at: (...segments: ReadonlyArray<string>) => string;
	/** Writes `content` at `relPath` under `root`, creating parent directories. */
	readonly write: (relPath: string, content?: string) => void;
}

/**
 * Seeds a volume from `seed` (paths relative to a fresh unique root) and
 * returns the {@link MemfsSync} over it.
 */
export const makeMemfsSync = (seed: MemoryFileSystemSeed, root: string = uniqueRoot()): MemfsSync => {
	const handle = MemoryFileSystem.makeSync(seed, { root });
	return {
		root,
		fs: handle.sync,
		withFaults: handle.withFaults,
		at: (...segments) => path.posix.join(root, ...segments),
		write: (relPath, content = "") => handle.write(relPath, content),
	};
};
