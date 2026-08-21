import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { findTestFiles } from "../src/utils/find-test-files.js";
import { isTestShapedPackage } from "../src/utils/is-test-shaped-package.js";
import { withMemfsWalker } from "./utils/memfs-walker.js";

/**
 * The discovery walkers used to call `node:fs/promises` directly, which made a
 * real temporary directory the only way to exercise them. They now read through
 * the `WalkerFileSystem` port (defaulting to `node:fs`), so a seeded virtual
 * volume drives the same code with no disk involved.
 *
 * These tests are the proof that the port is real: nothing here touches the
 * filesystem, and every path below exists only inside the volume.
 */
describe("discovery walkers over a virtual volume", () => {
	it("findTestFiles walks a seeded tree and matches only test files", async () => {
		const found = await withMemfsWalker(
			{
				"/pkg/src/utils.ts": "export const x = 1;",
				"/pkg/src/utils.test.ts": "test('x', () => {});",
				"/pkg/src/sub/helper.test.ts": "test('z', () => {});",
				"/pkg/src/index.ts": "export {};",
			},
			(fs) => findTestFiles("/pkg", ["src/**/*.test.ts"], fs),
		);

		expect([...found].sort()).toEqual(["/pkg/src/sub/helper.test.ts", "/pkg/src/utils.test.ts"]);
	});

	it("findTestFiles stops at a nested package boundary", async () => {
		const found = await withMemfsWalker(
			{
				"/pkg/src/own.test.ts": "test('own', () => {});",
				// A nested package.json makes this an independent unit — its tests
				// belong to a separate discovery pass, not this one.
				"/pkg/src/inner/package.json": '{ "name": "inner", "version": "1.0.0" }',
				"/pkg/src/inner/nested.test.ts": "test('nested', () => {});",
			},
			(fs) => findTestFiles("/pkg", ["src/**/*.test.ts"], fs),
		);

		expect(found).toEqual(["/pkg/src/own.test.ts"]);
	});

	it("findTestFiles prunes non-discoverable directories", async () => {
		const found = await withMemfsWalker(
			{
				"/pkg/src/real.test.ts": "test('real', () => {});",
				"/pkg/src/node_modules/dep/sneaky.test.ts": "test('sneaky', () => {});",
			},
			(fs) => findTestFiles("/pkg", ["src/**/*.test.ts"], fs),
		);

		expect(found).toEqual(["/pkg/src/real.test.ts"]);
	});

	// ── The view/port boundary ───────────────────────────────────────────────
	// A discovery walk must NOT follow symbolic links: in a pnpm workspace
	// `node_modules` is a farm of links into the content-addressed store, and
	// following them walks the store or hits a cycle. That requirement is served
	// by memfs' `Volume` view, which is literal — NOT by its `syncFileSystem`
	// port, which resolves links because workspace *enumeration* needs a
	// symlinked package to still count as a package.
	//
	// Same shape, opposite correct answer, one accessor apart. This test exists
	// so that moving the walker onto the port fails loudly here rather than
	// silently dragging the pnpm store into discovery.
	//
	// Scope of the guard, established by mutation: it catches an adapter that
	// resolves links in BOTH `readDirectory` and the entry-type check. Changing
	// only the type check does NOT fail it — the literal `readDirectory` then
	// throws on the link path and the walker absorbs that as an unreadable
	// directory. The invariant still holds in that half-state (nothing is
	// followed), so this guards the outcome that matters rather than every
	// intermediate edit.
	it("does not follow a symlinked directory into another tree", async () => {
		const found = await withMemfsWalker(
			{
				"/pkg/src/real.test.ts": "test('real', () => {});",
				"/elsewhere/sneaky.test.ts": "test('sneaky', () => {});",
				"/pkg/src/linked": MemoryFileSystem.symlink("/elsewhere"),
			},
			(fs) => findTestFiles("/pkg", ["src/**/*.test.ts"], fs),
		);

		expect(found).toEqual(["/pkg/src/real.test.ts"]);
	});

	// The other half of the same boundary: the guard above pins the *directory*
	// branch (do not recurse into a link), and this one pins the *file* branch
	// (do not collect one). A `Dirent` answers false to both `isFile()` and
	// `isDirectory()` for a symbolic link, so a link whose own name matches a
	// test-file glob is skipped on disk. An adapter deriving the file branch as
	// `!isDirectory` collects it instead — drift from `nodeWalkerFs` along
	// exactly the axis the port exists to keep honest, and invisible to the
	// directory-branch guard because a link to a *file* is never recursed into.
	it("does not collect a symlink whose own name matches a test-file glob", async () => {
		const found = await withMemfsWalker(
			{
				"/pkg/src/real.test.ts": "test('real', () => {});",
				"/real/helper.test.ts": "test('helper', () => {});",
				"/pkg/src/link.test.ts": MemoryFileSystem.symlink("/real/helper.test.ts"),
			},
			(fs) => findTestFiles("/pkg", ["src/**/*.test.ts"], fs),
		);

		expect(found).toEqual(["/pkg/src/real.test.ts"]);
	});

	it("isTestShapedPackage is true on a __test__ directory alone", async () => {
		const shaped = await withMemfsWalker({ "/pkg/__test__/whatever.txt": "not even a test file" }, (fs) =>
			isTestShapedPackage("/pkg", fs),
		);

		expect(shaped).toBe(true);
	});

	it("isTestShapedPackage is false for a package with neither shape", async () => {
		const shaped = await withMemfsWalker({ "/pkg/src/index.ts": "export {};" }, (fs) =>
			isTestShapedPackage("/pkg", fs),
		);

		expect(shaped).toBe(false);
	});
});
