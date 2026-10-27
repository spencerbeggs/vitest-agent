import * as path from "node:path";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { WalkerSyncOps } from "@effected/walker";

/**
 * `@effected/walker`'s {@link WalkerSyncOps} over an `@effected/memfs` handle.
 * The handle's `sync` port answers the same `readdirSync` / `statSync` /
 * `lstatSync` / `realpathSync` calls `nodeWalkerSyncOps` makes against the
 * real disk, so discovery walks run against a seeded virtual tree with node's
 * semantics: `stat` follows links, `lstat` does not. Seed an mtime with
 * `MemoryFileSystem.file(content, { mtime })` to exercise the mtime signature
 * walk, and a link with `MemoryFileSystem.symlink`.
 */
export const memfsWalkerOps = (handle: Pick<MemoryFileSystemHandle, "sync">): WalkerSyncOps => ({
	fileSystem: handle.sync,
	path,
});

/** Seeds a volume under `root` and returns its walker ops. */
export const seedMemfsWalker = (root: string, seed: MemoryFileSystemSeed): WalkerSyncOps =>
	memfsWalkerOps(MemoryFileSystem.makeSync(seed, { root }));
