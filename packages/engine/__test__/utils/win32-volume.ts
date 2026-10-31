import * as NodePath from "@effect/platform-node/NodePath";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { Path } from "effect";
import { Effect, FileSystem, Layer } from "effect";

/**
 * A win32-shaped platform over an `@effected/memfs` volume: Node's win32
 * `Path` (`NodePath.layerWin32`, so `join`/`dirname`/`basename` answer with
 * backslashes and drive roots, as on a Windows host) plus a `FileSystem`
 * that accepts win32 spellings.
 *
 * The volume stays POSIX, so the `FileSystem` translates every drive-rooted
 * argument (`C:\repo\a.json` -> `/C:/repo/a.json`) before delegating and
 * translates `realPath` answers back. A path that is not drive-rooted (a
 * POSIX spelling leaking out of POSIX-only path handling) is passed through
 * untranslated, so it misses the seed and reads as absent, which is how such
 * a path fails the code under test.
 *
 * Seed keys are win32 spellings (`C:\work\package.json`).
 */
const DRIVE_ROOTED = /^[A-Za-z]:[\\/]/;

const toVolume = (p: string): string => (DRIVE_ROOTED.test(p) ? `/${p.replaceAll("\\", "/")}` : p);

const fromVolume = (p: string): string => (/^\/[A-Za-z]:\//.test(p) ? p.slice(1).replaceAll("/", "\\") : p);

const translate = (fs: FileSystem.FileSystem): FileSystem.FileSystem =>
	new Proxy(fs, {
		get(target, key, receiver) {
			const member = Reflect.get(target, key, receiver);
			if (typeof member !== "function") return member;
			return (...args: ReadonlyArray<unknown>) => {
				const result = member.apply(
					target,
					args.map((arg) => (typeof arg === "string" ? toVolume(arg) : arg)),
				);
				return key === "realPath" ? Effect.map(result as Effect.Effect<string, unknown>, fromVolume) : result;
			};
		},
	});

/** The win32-shaped platform over a fresh volume seeded with `seed` (win32 keys). */
export const win32Volume = (
	seed: Record<string, MemoryFileSystemSeed[string]>,
): Layer.Layer<FileSystem.FileSystem | Path.Path> => {
	const posixSeed: MemoryFileSystemSeed = Object.fromEntries(
		Object.entries(seed).map(([key, value]) => [toVolume(key), value]),
	);
	const fileSystem = Layer.effect(FileSystem.FileSystem, Effect.map(FileSystem.FileSystem, translate)).pipe(
		Layer.provide(MemoryFileSystem.layerWith(posixSeed)),
	);
	return Layer.merge(fileSystem, NodePath.layerWin32);
};
