/**
 * The filesystem operations the discovery walkers need, supplied by the
 * caller. Node's built-ins satisfy it directly via {@link nodeWalkerFs}, which
 * is what every production call site uses.
 *
 * The port exists because the walkers used to call `node:fs/promises` outright,
 * which made them untestable against anything but a real temporary directory —
 * a virtual filesystem cannot intercept a direct `node:fs` call. Every test in
 * this package that exercised discovery therefore had to build, populate and
 * tear down a real tmp tree.
 *
 * Deliberately NOT `fs.promises`-shaped: the walkers need exactly two
 * operations, and a wider surface would invite call sites to reach past the
 * port. It is also NOT shaped like `@effected/workspaces`'s `SyncFileSystem`
 * (which this package consumes separately, in `discover-projects.ts`) — that
 * port answers entry *names*, and the walkers need the entry *type* that
 * `readdir({ withFileTypes: true })` returns in the same syscall. Reading names
 * and then stat-ing each one is the syscall-doubling this module exists to
 * avoid; see {@link WalkerEntry}.
 *
 * @packageDocumentation
 */

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";

/**
 * One directory entry, carrying the name and type together.
 *
 * A structural subset of Node's `Dirent`, so a real `Dirent` satisfies it
 * verbatim and `readdir({ withFileTypes: true })` needs no adaptation.
 * @public
 */
export interface WalkerEntry {
	/** The entry's own name, not a path. */
	readonly name: string;
	/** Whether this entry is a regular file. */
	readonly isFile: () => boolean;
	/** Whether this entry is a directory. */
	readonly isDirectory: () => boolean;
}

/**
 * The filesystem operations the discovery walkers need.
 *
 * Both operations may reject; every walker absorbs a rejection as "this path
 * contributes nothing" rather than propagating it, matching the behavior the
 * `node:fs` calls had when they were inline.
 * @public
 */
export interface WalkerFileSystem {
	/**
	 * The entries inside the directory at `dir`, with their types. May reject —
	 * a rejection reads as an unreadable directory and skips it.
	 */
	readonly readDirectory: (dir: string) => Promise<ReadonlyArray<WalkerEntry>>;
	/**
	 * The type of the entry at `path`, or `null` when it does not exist or
	 * cannot be read. Never rejects.
	 */
	readonly statEntry: (path: string) => Promise<WalkerEntryStat | null>;
}

/**
 * What the walkers read off a `stat`: the entry's type, plus the modification
 * time the discovery cache's directory signature is built from.
 * @public
 */
export interface WalkerEntryStat {
	/** Whether the path holds a regular file. */
	readonly isFile: boolean;
	/** Whether the path holds a directory. */
	readonly isDirectory: boolean;
	/** Modification time in milliseconds since the epoch. */
	readonly mtimeMs: number;
}

/**
 * {@link WalkerFileSystem} over `node:fs/promises` — the binding every
 * production call site uses, and the default when a walker is called without
 * an explicit port.
 * @public
 */
export const nodeWalkerFs: WalkerFileSystem = {
	readDirectory: async (dir) => (await readdir(dir, { withFileTypes: true })) as Dirent[],
	statEntry: async (path) => {
		try {
			const info = await stat(path);
			return { isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs };
		} catch {
			return null;
		}
	},
};
