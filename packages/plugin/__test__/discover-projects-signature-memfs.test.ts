import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { makeMemfsWorkspace, uniqueRoot } from "./utils/memfs-workspace.js";

/**
 * The discovery cache is invalidated by a directory signature built from
 * `relPath:mtimeMs` pairs (issue #100). The existing on-disk test covers the
 * case where a test file is ADDED — which changes the path set, so it would
 * invalidate even if mtimes were ignored entirely.
 *
 * The case that actually exercises the mtime half — an unchanged file set where
 * one file was touched — had no test, because a virtual volume could not
 * express a modification time until `@effected/memfs` grew `Volume.mtime` and
 * `file(content, { mtime })`.
 *
 * Both calls below run entirely inside a volume: the walkers read through the
 * `WalkerFileSystem` port, and `@effected/workspaces` resolves the root and the
 * package list through memfs' `syncFileSystem`. Nothing touches disk.
 */
type Files = Readonly<Record<string, MemoryFileSystemSeedEntry>>;

const seedFor = (testMtime: number): Files => ({
	"package.json": '{ "name": "root", "version": "0.0.0", "private": true }',
	"pnpm-workspace.yaml": "packages:\n  - packages/*\n",
	"packages/a/package.json": '{ "name": "@x/a", "version": "1.0.0" }',
	"packages/a/src/thing.ts": MemoryFileSystem.file("export const x = 1;", { mtime: 1_000 }),
	"packages/a/src/thing.test.ts": MemoryFileSystem.file("test('x', () => {});", { mtime: testMtime }),
});

const seedDeepWorkspace = (): Files => {
	const deepSegments = Array.from({ length: 34 }, (_, i) => `level-${i}`).join("/");
	const deepPkgDir = `packages/${deepSegments}/deep`;
	return {
		"package.json": '{ "name": "root", "version": "0.0.0", "private": true }',
		"pnpm-workspace.yaml": "packages:\n  - packages/**\n",
		"packages/shallow/package.json": '{ "name": "@x/shallow", "version": "1.0.0" }',
		"packages/shallow/src/shallow.test.ts": "test('shallow', () => {});",
		[`${deepPkgDir}/package.json`]: '{ "name": "@x/deep", "version": "1.0.0" }',
		[`${deepPkgDir}/src/deep.test.ts`]: "test('deep', () => {});",
	};
};

/**
 * Runs `discoverProjects` against a fresh volume seeded with `files` at `root`.
 * Two calls given the SAME root share `discoverProjects`' root-keyed cache —
 * which is exactly what the invalidation cases need — while each test takes
 * its own `uniqueRoot()` so no cache entry crosses a test boundary.
 */
const discoverIn = async (files: Files, root: string, options?: { readonly maxDepth?: number }) =>
	makeMemfsWorkspace(files, root).discover(options);

describe("discovery cache signature over a virtual volume", () => {
	it("discovers the seeded package through memfs' sync port", async () => {
		const result = await discoverIn(seedFor(1_000), uniqueRoot());

		// Positive control: if this found nothing, the invalidation assertions
		// below could pass by both calls returning the same empty answer.
		expect(result.projects).toBeDefined();
		expect(result.projects?.map((p) => p.test?.name)).toContain("@x/a");
	});

	it("returns the cached result when nothing changed", async () => {
		const root = uniqueRoot();
		const first = await discoverIn(seedFor(1_000), root);
		const second = await discoverIn(seedFor(1_000), root);

		expect(second).toBe(first);
	});

	it("invalidates the cache when a test file is touched but the file set is unchanged", async () => {
		const root = uniqueRoot();
		const first = await discoverIn(seedFor(1_000), root);
		const afterTouch = await discoverIn(seedFor(2_000), root);

		// Same paths, same contents, only mtime differs — so this can only pass
		// if the signature reads modification times.
		expect(afterTouch).not.toBe(first);
		expect(afterTouch.projects?.map((p) => p.test?.name)).toEqual(first.projects?.map((p) => p.test?.name));
	});

	it("excludes a package deeper than workspaces' default maxDepth (32)", async () => {
		const result = await discoverIn(seedDeepWorkspace(), uniqueRoot());

		const names = result.projects?.map((p) => p.test?.name) ?? [];
		expect(names).toContain("@x/shallow");
		expect(names).not.toContain("@x/deep");
	});

	it("includes a deep package when maxDepth is explicitly increased", async () => {
		const result = await discoverIn(seedDeepWorkspace(), uniqueRoot(), { maxDepth: 64 });

		const names = result.projects?.map((p) => p.test?.name) ?? [];
		expect(names).toContain("@x/shallow");
		expect(names).toContain("@x/deep");
	});
});
