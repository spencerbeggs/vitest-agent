import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
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
	function makeTempDir(): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), "pd-test-"));
	}

	const liveLayer = ProjectDiscoveryLive.pipe(Layer.provide(NodeFileSystem.layer));

	it("discovers test files in directory tree", async () => {
		const tmpDir = makeTempDir();
		const srcDir = path.join(tmpDir, "src");
		const subDir = path.join(srcDir, "sub");
		fs.mkdirSync(subDir, { recursive: true });

		// Create source files
		fs.writeFileSync(path.join(srcDir, "utils.ts"), "export const x = 1;");
		fs.writeFileSync(path.join(srcDir, "coverage.ts"), "export const y = 2;");
		fs.writeFileSync(path.join(subDir, "helper.ts"), "export const z = 3;");

		// Create test files
		fs.writeFileSync(path.join(srcDir, "utils.test.ts"), "test('x', () => {});");
		fs.writeFileSync(path.join(srcDir, "coverage.spec.ts"), "test('y', () => {});");
		fs.writeFileSync(path.join(subDir, "helper.test.ts"), "test('z', () => {});");

		// Non-test file should be ignored
		fs.writeFileSync(path.join(srcDir, "index.ts"), "export {};");

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.discoverTestFiles(tmpDir)),
				liveLayer,
			),
		);

		expect(result).toHaveLength(3);

		const testFiles = result.map((e) => e.testFile).sort();
		expect(testFiles).toContain(`${srcDir}/utils.test.ts`);
		expect(testFiles).toContain(`${srcDir}/coverage.spec.ts`);
		expect(testFiles).toContain(`${subDir}/helper.test.ts`);

		// All should have corresponding source files
		for (const entry of result) {
			expect(entry.sourceFiles).toHaveLength(1);
		}

		fs.rmSync(tmpDir, { recursive: true });
	});

	it(".test.ts maps to .ts source file", async () => {
		const tmpDir = makeTempDir();
		fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const foo = 1;");
		fs.writeFileSync(path.join(tmpDir, "foo.test.ts"), "test('foo', () => {});");

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${tmpDir}/foo.test.ts`)),
				liveLayer,
			),
		);

		expect(result).toEqual([`${tmpDir}/foo.ts`]);

		fs.rmSync(tmpDir, { recursive: true });
	});

	it(".spec.ts maps to .ts source file", async () => {
		const tmpDir = makeTempDir();
		fs.writeFileSync(path.join(tmpDir, "bar.ts"), "export const bar = 1;");
		fs.writeFileSync(path.join(tmpDir, "bar.spec.ts"), "test('bar', () => {});");

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${tmpDir}/bar.spec.ts`)),
				liveLayer,
			),
		);

		expect(result).toEqual([`${tmpDir}/bar.ts`]);

		fs.rmSync(tmpDir, { recursive: true });
	});

	it("returns empty array when no corresponding source file exists", async () => {
		const tmpDir = makeTempDir();
		fs.writeFileSync(path.join(tmpDir, "orphan.test.ts"), "test('orphan', () => {});");

		const result = await Effect.runPromise(
			Effect.provide(
				Effect.flatMap(ProjectDiscovery, (pd) => pd.mapTestToSource(`${tmpDir}/orphan.test.ts`)),
				liveLayer,
			),
		);

		expect(result).toEqual([]);

		fs.rmSync(tmpDir, { recursive: true });
	});
});
