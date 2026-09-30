import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import { findTestFiles } from "../src/utils/find-test-files.js";
import { memfsWalkerFs, seedMemfsWalker } from "./utils/memfs-walker.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Every case but the last runs against a seeded `@effected/memfs` volume
// through the `WalkerFileSystem` port: nothing touches disk, and every path
// below exists only inside the volume. `findTestFiles` keeps no cache, so a
// fixed root is safe to share across cases.

const ROOT = "/pkg";

/** Seeds `files` (relative to {@link ROOT}) and runs `findTestFiles` over them. */
const findIn = (
	files: Readonly<Record<string, MemoryFileSystemSeedEntry>>,
	patterns: ReadonlyArray<string>,
	dir: string = ROOT,
): Promise<ReadonlyArray<string>> => findTestFiles(dir, patterns, seedMemfsWalker(ROOT, files));

// ── Goal 16, Behavior 29: findTestFiles returns matched absolute paths ─────────

describe("findTestFiles", () => {
	it("should return absolute paths matching the glob pattern", async () => {
		// Given: a directory with some test files, one nested a level deeper
		// When: finding test files
		const results = await findIn(
			{
				"src/foo.test.ts": "",
				"src/bar.test.ts": "",
				"src/sub/helper.test.ts": "",
				"src/utils.ts": "", // non-test file
			},
			["src/**/*.test.ts"],
		);

		// Then: returns matched files as absolute paths
		expect(results).toHaveLength(3);
		for (const file of results) {
			expect(isAbsolute(file)).toBe(true);
		}
		expect(results).toContain(join(ROOT, "src", "foo.test.ts"));
		expect(results).toContain(join(ROOT, "src", "bar.test.ts"));
		expect(results).toContain(join(ROOT, "src", "sub", "helper.test.ts"));
	});

	it("should return absolute paths matching multiple glob patterns", async () => {
		// Given: a directory with test files in two locations
		// When: finding with two patterns
		const results = await findIn({ "src/foo.test.ts": "", "__test__/bar.test.ts": "" }, [
			"src/**/*.test.ts",
			"__test__/**/*.test.ts",
		]);

		// Then: both files are found
		expect(results).toHaveLength(2);
		expect(results).toContain(join(ROOT, "src", "foo.test.ts"));
		expect(results).toContain(join(ROOT, "__test__", "bar.test.ts"));
	});

	// ── Goal 16, Behavior 30: skips node_modules, .git, dist ──────────────────

	it("should skip node_modules directories automatically", async () => {
		// Given: a directory with a test file inside node_modules
		// When: finding test files
		const results = await findIn({ "node_modules/some-pkg/foo.test.ts": "", "src/real.test.ts": "" }, ["**/*.test.ts"]);

		// Then: node_modules file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(ROOT, "src", "real.test.ts"));
	});

	it("should skip a node_modules directory nested under an anchored include root", async () => {
		// Given: a node_modules directory inside src/, reachable by the anchored pattern
		// When: finding test files with that anchored pattern
		const results = await findIn({ "src/real.test.ts": "", "src/node_modules/dep/sneaky.test.ts": "" }, [
			"src/**/*.test.ts",
		]);

		// Then: the pruned directory contributes nothing
		expect(results).toEqual([join(ROOT, "src", "real.test.ts")]);
	});

	it("should skip .git directories automatically", async () => {
		// Given: a directory with a test file inside .git
		// When: finding test files
		const results = await findIn({ ".git/hooks/foo.test.ts": "", "src/real.test.ts": "" }, ["**/*.test.ts"]);

		// Then: .git file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(ROOT, "src", "real.test.ts"));
	});

	it("should skip dist directories automatically", async () => {
		// Given: a directory with a test file inside dist
		// When: finding test files
		const results = await findIn({ "dist/foo.test.ts": "", "src/real.test.ts": "" }, ["**/*.test.ts"]);

		// Then: dist file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(ROOT, "src", "real.test.ts"));
	});

	// ── issue #227: the walk must not cross a nested package boundary ──
	// `findTestFiles` is public and accepts unanchored patterns, so the boundary
	// guarantee is a contract in its own right even though discovery's own
	// include globs are anchored at the package root.

	it("should not descend into a nested directory with its own package.json", async () => {
		// Given: a root with its own test file, plus a nested dir that has both
		// a package.json (marking it as an independent package) and a test file
		// When: walking with an unanchored pattern that would otherwise reach the nested package
		const results = await findIn(
			{
				"src/real.test.ts": "",
				"packages/nested-pkg/package.json": JSON.stringify({ name: "nested-pkg" }),
				"packages/nested-pkg/__test__/other.test.ts": "",
			},
			["**/__test__/**/*.test.ts", "src/**/*.test.ts"],
		);

		// Then: only the root's own test file is found; the nested package's test is excluded
		expect(results).toContain(join(ROOT, "src", "real.test.ts"));
		expect(results).not.toContain(join(ROOT, "packages", "nested-pkg", "__test__", "other.test.ts"));
	});

	it("should still match files directly in the walk root, even though the root itself has a package.json", async () => {
		// Given: the walk root has its own package.json (as every real package does)
		// When: finding test files from that same root
		const results = await findIn({ "package.json": JSON.stringify({ name: "root-pkg" }), "__test__/foo.test.ts": "" }, [
			"__test__/**/*.test.ts",
		]);

		// Then: the root's own package.json does not block scanning its own children
		expect(results).toContain(join(ROOT, "__test__", "foo.test.ts"));
	});

	it("should apply the package-boundary rule even to an anchored src/** pattern (documented, intended)", async () => {
		// Given: a root with its own src/ test, plus a nested package under src/
		// that has its own package.json AND its own src/ test file. Pinning this:
		// the boundary check runs once per directory regardless of which pattern
		// is being matched, so an anchored "src/**" pattern loses visibility into
		// a nested package.json-bearing dir even though the pattern itself never
		// needed to reach past src/ to find it. There is no live case of this in
		// this repo today (no package nests another package.json under its own
		// src/), but the rule applies uniformly, so this test documents the
		// tradeoff rather than leaving it as an undocumented side effect.
		// When: walking with only the anchored src/** pattern
		const results = await findIn(
			{
				"src/real.test.ts": "",
				"src/vendored-pkg/package.json": JSON.stringify({ name: "vendored-pkg" }),
				"src/vendored-pkg/inner.test.ts": "",
			},
			["src/**/*.test.ts"],
		);

		// Then: the root's own src/ test is found; the nested package.json-bearing dir is excluded
		expect(results).toContain(join(ROOT, "src", "real.test.ts"));
		expect(results).not.toContain(join(ROOT, "src", "vendored-pkg", "inner.test.ts"));
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
		const found = await findTestFiles(
			"/pkg",
			["src/**/*.test.ts"],
			memfsWalkerFs(
				MemoryFileSystem.makeSync({
					"/pkg/src/real.test.ts": "test('real', () => {});",
					"/elsewhere/sneaky.test.ts": "test('sneaky', () => {});",
					"/pkg/src/linked": MemoryFileSystem.symlink("/elsewhere"),
				}),
			),
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
		const found = await findTestFiles(
			"/pkg",
			["src/**/*.test.ts"],
			memfsWalkerFs(
				MemoryFileSystem.makeSync({
					"/pkg/src/real.test.ts": "test('real', () => {});",
					"/real/helper.test.ts": "test('helper', () => {});",
					"/pkg/src/link.test.ts": MemoryFileSystem.symlink("/real/helper.test.ts"),
				}),
			),
		);

		expect(found).toEqual(["/pkg/src/real.test.ts"]);
	});

	// ── Goal 16, Behavior 31: returns empty array for no matches ──────────────

	it("should return [] for a path with no matching files", async () => {
		// Given: a directory with no test files
		// When: finding test files
		const results = await findIn({ "src/utils.ts": "" }, ["**/*.test.ts"]);

		// Then: returns empty array
		expect(results).toEqual([]);
	});

	it("should return [] for an empty patterns array", async () => {
		// Given: a directory with test files but empty patterns
		// When: finding with no patterns
		const results = await findIn({ "src/foo.test.ts": "" }, []);

		// Then: returns empty array
		expect(results).toEqual([]);
	});

	it("should return [] for a non-existent directory", async () => {
		// Given: a path that does not exist
		const nonExistent = join(ROOT, "does-not-exist");

		// When: finding test files
		const results = await findIn({ "src/foo.test.ts": "" }, ["**/*.test.ts"], nonExistent);

		// Then: returns empty array without throwing
		expect(results).toEqual([]);
	});

	// ── Real-disk smoke: the default `node:fs` binding ────────────────────────
	// Every case above injects the memfs port. This one omits it, so the
	// production default (`nodeWalkerFs`) is exercised end to end at least once.

	it("walks a real directory through the default node:fs binding", async () => {
		const tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-find-test-files-"));
		try {
			// Given: a real tree with a test file, a non-test file, and a pruned dir
			await mkdir(join(tmpDir, "src", "node_modules", "dep"), { recursive: true });
			await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
			await writeFile(join(tmpDir, "src", "utils.ts"), "");
			await writeFile(join(tmpDir, "src", "node_modules", "dep", "sneaky.test.ts"), "");

			// When: finding test files with no port argument
			const results = await findTestFiles(tmpDir, ["src/**/*.test.ts"]);

			// Then: only the real test file is found, as an absolute path
			expect(results).toEqual([join(tmpDir, "src", "foo.test.ts")]);
		} finally {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});
});
