import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ProjectDiscoveryLive } from "../src/layers/ProjectDiscoveryLive.js";
import { ProjectDiscoveryTest } from "../src/layers/ProjectDiscoveryTest.js";
import type { TestFileEntry } from "../src/services/ProjectDiscovery.js";
import { ProjectDiscovery } from "../src/services/ProjectDiscovery.js";

const cannedEntries: ReadonlyArray<TestFileEntry> = [
	{ testFile: "src/utils.test.ts", sourceFiles: ["src/utils.ts"] },
	{ testFile: "src/coverage.spec.ts", sourceFiles: ["src/coverage.ts"] },
	{ testFile: "src/orphan.test.ts", sourceFiles: [] },
];

describe("ProjectDiscoveryTest", () => {
	it("discoverTestFiles returns canned entries", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.discoverTestFiles("/any")),
				ProjectDiscoveryTest.layer(cannedEntries),
			),
		);

		expect(result).toHaveLength(3);
		expect(result[0].testFile).toBe("src/utils.test.ts");
		expect(result[0].sourceFiles).toEqual(["src/utils.ts"]);
	});

	it("mapTestToSource finds matching entry", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource("src/utils.test.ts")),
				ProjectDiscoveryTest.layer(cannedEntries),
			),
		);

		expect(result).toEqual(["src/utils.ts"]);
	});

	it("mapTestToSource returns empty for unknown file", async () => {
		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource("src/unknown.test.ts")),
				ProjectDiscoveryTest.layer(cannedEntries),
			),
		);

		expect(result).toEqual([]);
	});
});

describe("ProjectDiscoveryLive", () => {
	const ROOT = "/project";

	/**
	 * Runs `f` against a virtual volume seeded with `seed`.
	 *
	 * `ProjectDiscoveryLive` reaches the filesystem exclusively through
	 * `FileSystem.FileSystem` (`fs.readDirectory` / `fs.exists`, see
	 * `src/layers/ProjectDiscoveryLive.ts`), so a memory volume serves it
	 * completely and the `mkdtemp` + `rmSync` scaffolding this suite used to
	 * carry is gone. Honest absence matters here: the orphan case below asserts
	 * that an unseeded source path reads as missing, which a stubbed filesystem
	 * answering "empty file" would have silently passed.
	 */
	const withVolume = <A, E>(seed: Record<string, string>, effect: Effect.Effect<A, E, ProjectDiscovery>) =>
		Effect.runPromise(
			Effect.provide(effect, ProjectDiscoveryLive.pipe(Layer.provide(MemoryFileSystem.layerWith(seed)))),
		);

	it("discovers test files in directory tree", async () => {
		const result = await withVolume(
			{
				[`${ROOT}/src/utils.ts`]: "export const x = 1;",
				[`${ROOT}/src/coverage.ts`]: "export const y = 2;",
				[`${ROOT}/src/sub/helper.ts`]: "export const z = 3;",
				[`${ROOT}/src/utils.test.ts`]: "test('x', () => {});",
				[`${ROOT}/src/coverage.spec.ts`]: "test('y', () => {});",
				[`${ROOT}/src/sub/helper.test.ts`]: "test('z', () => {});",
				// Non-test file should be ignored
				[`${ROOT}/src/index.ts`]: "export {};",
			},
			Effect.flatMap(ProjectDiscovery, (pd) => pd.discoverTestFiles(ROOT)),
		);

		expect(result).toHaveLength(3);

		const testFiles = result.map((e) => e.testFile);
		expect(testFiles).toContain(`${ROOT}/src/utils.test.ts`);
		expect(testFiles).toContain(`${ROOT}/src/coverage.spec.ts`);
		expect(testFiles).toContain(`${ROOT}/src/sub/helper.test.ts`);

		// All should have corresponding source files
		for (const entry of result) {
			expect(entry.sourceFiles).toHaveLength(1);
		}
	});

	it(".test.ts maps to .ts source file", async () => {
		const result = await withVolume(
			{
				[`${ROOT}/foo.ts`]: "export const foo = 1;",
				[`${ROOT}/foo.test.ts`]: "test('foo', () => {});",
			},
			Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${ROOT}/foo.test.ts`)),
		);

		expect(result).toEqual([`${ROOT}/foo.ts`]);
	});

	it(".spec.ts maps to .ts source file", async () => {
		const result = await withVolume(
			{
				[`${ROOT}/bar.ts`]: "export const bar = 1;",
				[`${ROOT}/bar.spec.ts`]: "test('bar', () => {});",
			},
			Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${ROOT}/bar.spec.ts`)),
		);

		expect(result).toEqual([`${ROOT}/bar.ts`]);
	});

	it("returns empty array when no corresponding source file exists", async () => {
		const result = await withVolume(
			{ [`${ROOT}/orphan.test.ts`]: "test('orphan', () => {});" },
			Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${ROOT}/orphan.test.ts`)),
		);

		expect(result).toEqual([]);
	});
});
