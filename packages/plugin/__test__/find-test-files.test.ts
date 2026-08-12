import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTestFiles } from "../src/utils/find-test-files.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-find-test-files-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

// ── Goal 16, Behavior 29: findTestFiles returns matched absolute paths ─────────

describe("findTestFiles", () => {
	it("should return absolute paths matching the glob pattern", async () => {
		// Given: a directory with some test files
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
		await writeFile(join(tmpDir, "src", "bar.test.ts"), "");
		await writeFile(join(tmpDir, "src", "utils.ts"), ""); // non-test file

		// When: finding test files
		const results = await findTestFiles(tmpDir, ["src/**/*.test.ts"]);

		// Then: returns matched files as absolute paths
		expect(results).toHaveLength(2);
		for (const file of results) {
			expect(isAbsolute(file)).toBe(true);
		}
		expect(results).toContain(join(tmpDir, "src", "foo.test.ts"));
		expect(results).toContain(join(tmpDir, "src", "bar.test.ts"));
	});

	it("should return absolute paths matching multiple glob patterns", async () => {
		// Given: a directory with test files in two locations
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
		await writeFile(join(tmpDir, "__test__", "bar.test.ts"), "");

		// When: finding with two patterns
		const results = await findTestFiles(tmpDir, ["src/**/*.test.ts", "__test__/**/*.test.ts"]);

		// Then: both files are found
		expect(results).toHaveLength(2);
		expect(results).toContain(join(tmpDir, "src", "foo.test.ts"));
		expect(results).toContain(join(tmpDir, "__test__", "bar.test.ts"));
	});

	// ── Goal 16, Behavior 30: skips node_modules, .git, dist ──────────────────

	it("should skip node_modules directories automatically", async () => {
		// Given: a directory with a test file inside node_modules
		await mkdir(join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
		await writeFile(join(tmpDir, "node_modules", "some-pkg", "foo.test.ts"), "");
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "real.test.ts"), "");

		// When: finding test files
		const results = await findTestFiles(tmpDir, ["**/*.test.ts"]);

		// Then: node_modules file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(tmpDir, "src", "real.test.ts"));
	});

	it("should skip .git directories automatically", async () => {
		// Given: a directory with a test file inside .git
		await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
		await writeFile(join(tmpDir, ".git", "hooks", "foo.test.ts"), "");
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "real.test.ts"), "");

		// When: finding test files
		const results = await findTestFiles(tmpDir, ["**/*.test.ts"]);

		// Then: .git file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(tmpDir, "src", "real.test.ts"));
	});

	it("should skip dist directories automatically", async () => {
		// Given: a directory with a test file inside dist
		await mkdir(join(tmpDir, "dist"), { recursive: true });
		await writeFile(join(tmpDir, "dist", "foo.test.ts"), "");
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "real.test.ts"), "");

		// When: finding test files
		const results = await findTestFiles(tmpDir, ["**/*.test.ts"]);

		// Then: dist file is excluded
		expect(results).toHaveLength(1);
		expect(results[0]).toBe(join(tmpDir, "src", "real.test.ts"));
	});

	// ── issue #227: the walk must not cross a nested package boundary ──
	// `findTestFiles` is public and accepts unanchored patterns, so the boundary
	// guarantee is a contract in its own right even though discovery's own
	// include globs are anchored at the package root.

	it("should not descend into a nested directory with its own package.json", async () => {
		// Given: a root with its own test file, plus a nested dir that has both
		// a package.json (marking it as an independent package) and a test file
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "real.test.ts"), "");
		await mkdir(join(tmpDir, "packages", "nested-pkg", "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "packages", "nested-pkg", "package.json"), JSON.stringify({ name: "nested-pkg" }));
		await writeFile(join(tmpDir, "packages", "nested-pkg", "__test__", "other.test.ts"), "");

		// When: walking with an unanchored pattern that would otherwise reach the nested package
		const results = await findTestFiles(tmpDir, ["**/__test__/**/*.test.ts", "src/**/*.test.ts"]);

		// Then: only the root's own test file is found; the nested package's test is excluded
		expect(results).toContain(join(tmpDir, "src", "real.test.ts"));
		expect(results).not.toContain(join(tmpDir, "packages", "nested-pkg", "__test__", "other.test.ts"));
	});

	it("should still match files directly in the walk root, even though the root itself has a package.json", async () => {
		// Given: the walk root has its own package.json (as every real package does)
		await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "root-pkg" }));
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "__test__", "foo.test.ts"), "");

		// When: finding test files from that same root
		const results = await findTestFiles(tmpDir, ["__test__/**/*.test.ts"]);

		// Then: the root's own package.json does not block scanning its own children
		expect(results).toContain(join(tmpDir, "__test__", "foo.test.ts"));
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
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "real.test.ts"), "");
		await mkdir(join(tmpDir, "src", "vendored-pkg"), { recursive: true });
		await writeFile(join(tmpDir, "src", "vendored-pkg", "package.json"), JSON.stringify({ name: "vendored-pkg" }));
		await writeFile(join(tmpDir, "src", "vendored-pkg", "inner.test.ts"), "");

		// When: walking with only the anchored src/** pattern
		const results = await findTestFiles(tmpDir, ["src/**/*.test.ts"]);

		// Then: the root's own src/ test is found; the nested package.json-bearing dir is excluded
		expect(results).toContain(join(tmpDir, "src", "real.test.ts"));
		expect(results).not.toContain(join(tmpDir, "src", "vendored-pkg", "inner.test.ts"));
	});

	// ── Goal 16, Behavior 31: returns empty array for no matches ──────────────

	it("should return [] for a path with no matching files", async () => {
		// Given: a directory with no test files
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "utils.ts"), "");

		// When: finding test files
		const results = await findTestFiles(tmpDir, ["**/*.test.ts"]);

		// Then: returns empty array
		expect(results).toEqual([]);
	});

	it("should return [] for an empty patterns array", async () => {
		// Given: a directory with test files but empty patterns
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");

		// When: finding with no patterns
		const results = await findTestFiles(tmpDir, []);

		// Then: returns empty array
		expect(results).toEqual([]);
	});

	it("should return [] for a non-existent directory", async () => {
		// Given: a path that does not exist
		const nonExistent = join(tmpDir, "does-not-exist");

		// When: finding test files
		const results = await findTestFiles(nonExistent, ["**/*.test.ts"]);

		// Then: returns empty array without throwing
		expect(results).toEqual([]);
	});
});
