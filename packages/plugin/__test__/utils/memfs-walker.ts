import type { MemoryFileSystemSeed, MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import type { WalkerEntry, WalkerEntryStat, WalkerFileSystem } from "../../src/utils/walker-fs.js";

/**
 * A {@link WalkerFileSystem} over an `@effected/memfs` volume, so discovery
 * walks run against a seeded virtual tree instead of a real temporary
 * directory.
 *
 * Built on the volume's synchronous inspection view (`readDirectory` /
 * `isDirectory` / `has`), which is why the seeded layer has to be an
 * `Inspectable` one — the plain `layer` / `layerWith` constructors publish no
 * `Volume`.
 *
 * `mtimeMs` comes from the volume's own `mtime`, so mtime-fingerprinting walks
 * — the discovery cache's `computeDirSignature` — are exercisable too. Seed a
 * time with `MemoryFileSystem.file(content, { mtime })`.
 *
 * `mtime` answering `undefined` is what distinguishes an absent path from one
 * modified at the epoch: `0` is a real modification time, so a synthesized zero
 * would be indistinguishable from a genuine 1970 timestamp.
 *
 * A symbolic link answers `false` to BOTH `isFile` and `isDirectory`, which is
 * what the `Dirent` this port mirrors reports for one. Deriving the file branch
 * as `!isDirectory` instead would over-report a link as a regular file, and the
 * adapter would drift from `nodeWalkerFs` along exactly the symlink axis the
 * walkers guard: a link named `link.test.ts` matches a test-file glob, so
 * `findTestFiles` would collect it here and skip it on disk. `readLink` is the
 * discriminator — it is literal, and answers `undefined` for a non-link.
 *
 * Only the file branch needs that check. `isDirectory` is literal too, so it
 * already answers `false` for a link pointing at a directory, and short-
 * circuiting on it keeps `readLink` off the directory path entirely.
 */
export const memfsWalkerFs = (volume: MemoryFileSystemVolume): WalkerFileSystem => ({
	readDirectory: async (dir) => {
		const names = volume.readDirectory(dir);
		// Absent or not-a-directory: reject, matching what `node:fs` raises and
		// what every walker absorbs as "this path contributes nothing".
		if (names === undefined) throw new Error(`ENOENT: no such directory, scandir '${dir}'`);
		return names.map((name): WalkerEntry => {
			const full = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
			const isDir = volume.isDirectory(full);
			const isFile = !isDir && volume.readLink(full) === undefined;
			return { name, isFile: () => isFile, isDirectory: () => isDir };
		});
	},
	statEntry: async (path): Promise<WalkerEntryStat | null> => {
		const mtimeMs = volume.mtime(path);
		// Absent — not "present at the epoch". See the note above.
		if (mtimeMs === undefined) return null;
		const isDirectory = volume.isDirectory(path);
		const isFile = !isDirectory && volume.readLink(path) === undefined;
		return { isFile, isDirectory, mtimeMs };
	},
});

/** Seeds a volume and hands its walker adapter to `f`. */
export const withMemfsWalker = <A>(seed: MemoryFileSystemSeed, f: (fs: WalkerFileSystem) => Promise<A>): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			return yield* Effect.promise(() => f(memfsWalkerFs(volume)));
		}),
	);
