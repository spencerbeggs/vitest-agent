import * as path from "node:path";
import type { MemoryFileSystemSeedEntry, MemoryFileSystemSyncFileSystem } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { rootedSeed } from "./memfs-walker.js";
import { uniqueRoot } from "./memfs-workspace.js";

/**
 * A seeded `@effected/memfs` volume presented through its node-shaped sync
 * port (`exists` / `readFile` / `readDirectory` / `isDirectory`), for
 * production seams that take a synchronous `node:fs` subset.
 */
export interface MemfsSync {
	/** Absolute root the seed was placed under. */
	readonly root: string;
	readonly fs: MemoryFileSystemSyncFileSystem;
	/** `root` joined with `segments`, POSIX-style (the volume's separator). */
	readonly at: (...segments: ReadonlyArray<string>) => string;
	/** Writes `content` at `relPath` under `root`, creating parent directories. */
	readonly write: (relPath: string, content?: string) => Promise<void>;
}

/**
 * Seeds a volume from `files` (paths relative to a fresh unique root) and
 * returns the {@link MemfsSync} over it.
 */
export const makeMemfsSync = async (
	files: Readonly<Record<string, MemoryFileSystemSeedEntry>>,
	root: string = uniqueRoot(),
): Promise<MemfsSync> => {
	const { fileSystem, volume } = await Effect.runPromise(MemoryFileSystem.makeInspectableWith(rootedSeed(root, files)));
	return {
		root,
		fs: MemoryFileSystem.syncFileSystem(volume),
		at: (...segments) => path.posix.join(root, ...segments),
		write: (relPath, content = "") => {
			const abs = path.posix.join(root, relPath);
			return Effect.runPromise(
				Effect.andThen(
					fileSystem.makeDirectory(path.posix.dirname(abs), { recursive: true }),
					fileSystem.writeFileString(abs, content),
				),
			);
		},
	};
};
