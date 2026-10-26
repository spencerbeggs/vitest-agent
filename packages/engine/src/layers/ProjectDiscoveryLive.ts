import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { descend } from "@effected/walker";
import { DiscoveryError, NON_DISCOVERABLE_DIRS } from "@vitest-agent/sdk";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { TestFileEntry } from "../services/ProjectDiscovery.js";
import { ProjectDiscovery } from "../services/ProjectDiscovery.js";

// The shared non-discoverable set plus the tool-output directories this
// source-file walk also has no interest in. Extends NON_DISCOVERABLE_DIRS
// rather than restating it, so the three names it shares with discovery's
// walkers cannot drift.
const SKIP_DIRS: ReadonlyArray<string> = [...NON_DISCOVERABLE_DIRS, "coverage", ".turbo", ".vite"];

// `dot: true` so dot directories outside SKIP_DIRS are walked, as the former
// hand-rolled recursion walked them.
const TEST_FILE_GLOB = "**/*.{test,spec}.{ts,tsx}";
const TEST_FILE_GLOB_OPTIONS = GlobPatternOptions.make({ dot: true });

function testFileToSource(testFile: string): string {
	return testFile.replace(/\.(test|spec)\.(ts|tsx)$/, ".$2");
}

/**
 * Every test file under `rootDir`, as `${rootDir}/<relative>` paths sorted by
 * relative path. `@effected/walker`'s `descend` follows directory symlinks
 * (as the former `fs.stat`-based walk did) under its ancestor-chain cycle
 * guard, so a link back to an ancestor is skipped instead of recursing until
 * the OS answers `ELOOP` and failing the whole discovery.
 */
const walkTestFiles = (rootDir: string) =>
	Effect.gen(function* () {
		const pattern = yield* GlobPattern.compile(TEST_FILE_GLOB, TEST_FILE_GLOB_OPTIONS);
		const relative = yield* descend(pattern, { cwd: rootDir, prune: SKIP_DIRS, followSymlinks: true });
		const base = rootDir.endsWith("/") ? rootDir.slice(0, -1) : rootDir;
		return relative.map((rel) => `${base}/${rel}`);
	}).pipe(Effect.provide(Path.layer));

/** @public */
export const ProjectDiscoveryLive: Layer.Layer<ProjectDiscovery, never, FileSystem.FileSystem> = Layer.effect(
	ProjectDiscovery,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const mapTestToSource = (testFile: string): Effect.Effect<ReadonlyArray<string>, DiscoveryError> =>
			Effect.gen(function* () {
				const sourceFile = testFileToSource(testFile);
				const exists = yield* fs.exists(sourceFile);
				return exists ? [sourceFile] : [];
			}).pipe(
				Effect.mapError(
					(error) =>
						new DiscoveryError({
							operation: "stat",
							path: testFile,
							reason: String(error),
						}),
				),
			);

		return {
			discoverTestFiles: (rootDir: string): Effect.Effect<ReadonlyArray<TestFileEntry>, DiscoveryError> =>
				Effect.gen(function* () {
					const testFiles = yield* walkTestFiles(rootDir).pipe(
						Effect.provideService(FileSystem.FileSystem, fs),
						Effect.mapError(
							(error) =>
								new DiscoveryError({
									operation: "glob",
									path: rootDir,
									reason: String(error),
								}),
						),
					);
					const entries: TestFileEntry[] = [];
					for (const testFile of testFiles) {
						const sourceFiles = yield* mapTestToSource(testFile);
						entries.push({ testFile, sourceFiles });
					}
					return entries;
				}),
			mapTestToSource,
		};
	}),
);
