// Tests for buildModuleInfo utility (packages/plugin/src/utils/build-module-info.ts)
//
// Every walk runs over an `@effected/memfs` volume through the injectable
// `fs` port, so "nothing above the file has a package.json" is a seeded fact
// rather than an assumption about what lives above os.tmpdir(). One smoke case
// keeps the default `node:fs` binding exercised against a real temp tree.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModuleInfo, clearBuildModuleInfoCache } from "../src/utils/build-module-info.js";
import { makeMemfsSync } from "./utils/memfs-sync.js";

describe("buildModuleInfo", () => {
	beforeEach(() => {
		clearBuildModuleInfoCache();
	});

	afterEach(() => {
		clearBuildModuleInfoCache();
	});

	it("should populate packageName and packagePath from the nearest package.json", async () => {
		// Given: a file inside a directory that has a package.json
		const vol = makeMemfsSync({
			"package.json": JSON.stringify({ name: "test-pkg" }),
			"src/foo.ts": "",
		});

		// When: buildModuleInfo is called
		const result = buildModuleInfo(vol.at("src", "foo.ts"), vol.fs);

		// Then: packageName and packagePath are populated from the package.json
		expect(result.packageName).toBe("test-pkg");
		expect(result.packagePath).toBe(vol.root);
	});

	it("should walk past parent directories that have no package.json to find the nearest one", async () => {
		// Given: an outer package, and a nested package whose file sits two
		// manifest-less directories below its package.json
		const vol = makeMemfsSync({
			"package.json": JSON.stringify({ name: "outer-pkg" }),
			"packages/inner/package.json": JSON.stringify({ name: "inner-pkg" }),
			"packages/inner/src/deep/foo.ts": "",
		});

		// When: buildModuleInfo is called
		const result = buildModuleInfo(vol.at("packages", "inner", "src", "deep", "foo.ts"), vol.fs);

		// Then: the nearest (inner) package.json is used, not the outer one
		expect(result.packageName).toBe("inner-pkg");
		expect(result.packagePath).toBe(vol.at("packages", "inner"));
	});

	it("should return empty strings when no package.json is found before filesystem root", async () => {
		// Given: a volume with no package.json anywhere — deterministic, unlike
		// the real-disk version which could hit a package.json above os.tmpdir()
		const vol = makeMemfsSync({ "no-pkg.ts": "" });

		// When: buildModuleInfo is called on a path with no package.json ancestor
		const result = buildModuleInfo(vol.at("no-pkg.ts"), vol.fs);

		// Then: the walk reaches the root and falls back to empty strings
		expect(result.packageName).toBe("");
		expect(result.packagePath).toBe("");
	});

	describe("caching", () => {
		it("should cache results so a second call for the same package returns without re-reading disk", async () => {
			// Given: first call populates the cache
			const vol = makeMemfsSync({
				"package.json": JSON.stringify({ name: "test-pkg" }),
				"src/foo.ts": "",
			});
			const filePath = vol.at("src", "foo.ts");
			const first = buildModuleInfo(filePath, vol.fs);
			expect(first.packageName).toBe("test-pkg");

			// When: the package.json is modified and buildModuleInfo is called again
			vol.write("package.json", JSON.stringify({ name: "renamed" }));
			expect(vol.fs.readFile(vol.at("package.json"))).toContain("renamed");
			const second = buildModuleInfo(filePath, vol.fs);

			// Then: the cached value is returned (the change is invisible without a cache clear)
			expect(second.packageName).toBe("test-pkg");

			// And: clearing the cache makes the change visible
			clearBuildModuleInfoCache();
			expect(buildModuleInfo(filePath, vol.fs).packageName).toBe("renamed");
		});

		it("should populate a different package's name when called with a file in a different location", async () => {
			// Given: cache is seeded with test-pkg
			const vol = makeMemfsSync({
				"a/package.json": JSON.stringify({ name: "test-pkg" }),
				"a/src/foo.ts": "",
				"b/package.json": JSON.stringify({ name: "other-pkg" }),
				"b/src/bar.ts": "",
			});
			buildModuleInfo(vol.at("a", "src", "foo.ts"), vol.fs);

			// When: buildModuleInfo is called for a file in the second package
			const result = buildModuleInfo(vol.at("b", "src", "bar.ts"), vol.fs);

			// Then: the correct (non-cached) package name is returned
			expect(result.packageName).toBe("other-pkg");
			expect(result.packagePath).toBe(vol.at("b"));
		});
	});

	it("should walk past a malformed package.json to the next valid ancestor", async () => {
		// Given: a file whose nearest package.json is invalid JSON, under an
		// outer package with a valid manifest
		const vol = makeMemfsSync({
			"package.json": JSON.stringify({ name: "outer-pkg" }),
			"bad/package.json": "{ this is not valid json !!!",
			"bad/src/foo.ts": "",
		});

		// When: buildModuleInfo is called — must not throw
		let result: ReturnType<typeof buildModuleInfo> | undefined;
		expect(() => {
			result = buildModuleInfo(vol.at("bad", "src", "foo.ts"), vol.fs);
		}).not.toThrow();

		// Then: the malformed manifest is skipped and the outer one wins
		expect(result?.packageName).toBe("outer-pkg");
		expect(result?.packagePath).toBe(vol.root);
	});

	it("should fall back to empty strings when the only package.json is malformed", async () => {
		const vol = makeMemfsSync({
			"package.json": "{ this is not valid json !!!",
			"src/foo.ts": "",
		});

		const result = buildModuleInfo(vol.at("src", "foo.ts"), vol.fs);

		expect(result.packageName).toBe("");
		expect(result.packagePath).toBe("");
	});

	it("should strip query strings from the file path", async () => {
		// Given: an id with a Vite query string appended
		const vol = makeMemfsSync({
			"package.json": JSON.stringify({ name: "fields-pkg" }),
			"src/foo.ts": "",
		});
		const filePath = `${vol.at("src", "foo.ts")}?v=1234`;

		// When: buildModuleInfo is called
		const result = buildModuleInfo(filePath, vol.fs);

		// Then: the path does not include the query string, and the walk still resolves
		expect(result.path).toBe(vol.at("src", "foo.ts"));
		expect(result.filename).toBe("foo.ts");
		expect(result.packageName).toBe("fields-pkg");
	});

	describe("default node:fs binding (real disk smoke)", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = mkdtempSync(join(tmpdir(), "build-module-info-test-"));
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "disk-pkg" }));
			mkdirSync(join(tmpDir, "src"));
			writeFileSync(join(tmpDir, "src", "foo.ts"), "");
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("should read the nearest package.json from disk when no fs is injected", () => {
			const result = buildModuleInfo(join(tmpDir, "src", "foo.ts"));

			expect(result.packageName).toBe("disk-pkg");
			expect(result.packagePath).toBe(tmpDir);
		});
	});
});
