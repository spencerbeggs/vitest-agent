import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Layer } from "effect";
import { DiscoveryError } from "../errors/DiscoveryError.js";
import type { TestFileEntry } from "../services/ProjectDiscovery.js";
import { ProjectDiscovery } from "../services/ProjectDiscovery.js";

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".turbo", ".vite"]);

function isTestFile(filePath: string): boolean {
	return TEST_FILE_PATTERN.test(filePath);
}

function testFileToSource(testFile: string): string {
	return testFile.replace(/\.(test|spec)\.(ts|tsx)$/, ".$2");
}

function walkDir(fs: FileSystem.FileSystem, dir: string): Effect.Effect<ReadonlyArray<string>, PlatformError> {
	return Effect.gen(function* () {
		const entries = yield* fs.readDirectory(dir);
		const results: string[] = [];
		for (const entry of entries) {
			if (SKIP_DIRS.has(entry)) continue;
			const fullPath = `${dir}/${entry}`;
			const stat = yield* fs.stat(fullPath);
			if (stat.type === "Directory") {
				const subFiles = yield* walkDir(fs, fullPath);
				results.push(...subFiles);
			} else {
				results.push(fullPath);
			}
		}
		return results;
	});
}
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
					const allFiles = yield* walkDir(fs, rootDir).pipe(
						Effect.mapError(
							(error) =>
								new DiscoveryError({
									operation: "glob",
									path: rootDir,
									reason: String(error),
								}),
						),
					);
					const testFiles = allFiles.filter(isTestFile);
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
