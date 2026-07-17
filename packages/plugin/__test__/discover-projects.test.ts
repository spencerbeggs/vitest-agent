import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { DiscoverStrategy } from "../src/utils/discover-strategy.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-discover-"));
	await writeFile(join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
	await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function createPkg(
	name: string,
	opts: {
		hasUnit?: boolean;
		hasInt?: boolean;
		hasE2e?: boolean;
		setupFile?: boolean;
		// Place test files in __test__/ instead of src/
		testDirUnit?: boolean;
		testDirInt?: boolean;
		testDirE2e?: boolean;
	} = {},
) {
	const pkgDir = join(tmpDir, "packages", name);
	await mkdir(join(pkgDir, "src"), { recursive: true });
	await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: `@test/${name}`, version: "0.0.0" }));
	if (opts.hasUnit) await writeFile(join(pkgDir, "src", "index.test.ts"), "");
	if (opts.hasInt) await writeFile(join(pkgDir, "src", "index.int.test.ts"), "");
	if (opts.hasE2e) await writeFile(join(pkgDir, "src", "index.e2e.test.ts"), "");
	if (opts.setupFile) await writeFile(join(pkgDir, "vitest.setup.ts"), "");
	if (opts.testDirUnit) {
		await mkdir(join(pkgDir, "__test__"), { recursive: true });
		await writeFile(join(pkgDir, "__test__", "index.test.ts"), "");
	}
	if (opts.testDirInt) {
		await mkdir(join(pkgDir, "__test__", "integration"), { recursive: true });
		await writeFile(join(pkgDir, "__test__", "integration", "index.int.test.ts"), "");
	}
	if (opts.testDirE2e) {
		await mkdir(join(pkgDir, "__test__", "e2e"), { recursive: true });
		await writeFile(join(pkgDir, "__test__", "e2e", "index.e2e.test.ts"), "");
	}
}

describe("discoverProjects()", () => {
	it("should accept an options-bag { cwd } and behave identically to positional call", async () => {
		// Given: a package with a unit test
		await createPkg("opts-bag", { hasUnit: true });

		// When: discoverProjects is called with the new options-bag signature
		const { projects } = await discoverProjects({ cwd: tmpDir });

		// Then: it resolves one project named after the package
		expect(projects).toHaveLength(1);
		expect(projects?.[0].test?.name).toBe("@test/opts-bag");
	});

	it("should return TestProjectInlineConfiguration objects directly (not VitestProject)", async () => {
		// Given: a package with a unit test
		await createPkg("alpha", { hasUnit: true });

		// When: discoverProjects is called
		const { projects } = await discoverProjects({ cwd: tmpDir });

		// Then: projects are plain TestProjectInlineConfiguration objects
		expect(projects).toHaveLength(1);
		const p = projects?.[0];
		// TestProjectInlineConfiguration shape: { extends: true, test: { name, include, ... } }
		expect(p).toHaveProperty("test");
		expect(p?.test?.name).toBe("@test/alpha");
		// VitestProject had .name and .kind on the instance — plain config objects do not
		expect((p as { name?: string }).name).toBeUndefined();
		expect((p as { kind?: string }).kind).toBeUndefined();
	});

	it("should use bare package name as test.name for any test kind", async () => {
		await createPkg("beta", { hasInt: true });
		const { projects } = await discoverProjects({ cwd: tmpDir });
		expect(projects?.[0].test?.name).toBe("@test/beta");
	});

	it("should skip packages with no test files (strategy returns null)", async () => {
		// Create a package with src/ but no test files
		const pkgDir = join(tmpDir, "packages", "no-tests");
		await mkdir(join(pkgDir, "src"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/no-tests", version: "0.0.0" }));
		await writeFile(join(pkgDir, "src", "index.ts"), "export const x = 1;");
		const { projects } = await discoverProjects({ cwd: tmpDir });
		expect(projects === undefined || projects.every((p) => p.test?.name !== "@test/no-tests")).toBe(true);
	});

	it("should wire setupFiles when vitest.setup.ts exists at package root", async () => {
		await createPkg("setup-pkg", { hasUnit: true, setupFile: true });
		const { projects } = await discoverProjects({ cwd: tmpDir });
		const p = projects?.[0];
		expect(p?.test?.setupFiles).toBeDefined();
		expect((p?.test?.setupFiles as string[] | undefined)?.some((f) => f.includes("vitest.setup.ts"))).toBe(true);
	});

	it("should throw when workspace root cannot be found", async () => {
		await expect(discoverProjects({ cwd: `/tmp/no-workspace-${Date.now()}` })).rejects.toThrow();
	});

	describe("__test__/ directory support", () => {
		it("should include __test__/ glob when __test__/ has test files", async () => {
			await createPkg("td-unit", { testDirUnit: true });
			const { projects } = await discoverProjects({ cwd: tmpDir });
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include int test files via __test__/ glob", async () => {
			await createPkg("td-int", { testDirInt: true });
			const { projects } = await discoverProjects({ cwd: tmpDir });
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include e2e test files via __test__/ glob", async () => {
			await createPkg("td-e2e", { testDirE2e: true });
			const { projects } = await discoverProjects({ cwd: tmpDir });
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include patterns for both src/ and __test__/", async () => {
			await createPkg("td-both", { hasUnit: true, testDirUnit: true });
			const { projects } = await discoverProjects({ cwd: tmpDir });
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("src/"))).toBe(true);
			expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		});

		it("should exclude utils/ fixtures/ snapshots/ inside __test__/", async () => {
			await createPkg("td-excl", { testDirUnit: true });
			const { projects } = await discoverProjects({ cwd: tmpDir });
			const exclude = projects?.[0].test?.exclude as string[] | undefined;
			expect(exclude).toBeDefined();
			expect(exclude?.some((p) => p.includes("__test__/utils"))).toBe(true);
			expect(exclude?.some((p) => p.includes("__test__/fixtures"))).toBe(true);
			expect(exclude?.some((p) => p.includes("__test__/snapshots"))).toBe(true);
		});
	});

	describe("Phase 4: new fixtures (spec §5)", () => {
		it("should return one project for a single-package repo (validates relativePath==='.' skip removal)", async () => {
			// Given: a single-package tmp dir marked as a workspace root via a
			// `workspaces` field in package.json + package.json + src/foo.test.ts.
			// @effected/workspaces@0.3 recognises a workspace root by a
			// pnpm-workspace.yaml or a package.json `workspaces` field — the
			// former `.git`-as-boundary heuristic of workspaces-effect@1.x was
			// dropped, so the root marker is now the self-referencing workspaces
			// field. The root package is still enumerated with relativePath ".".
			const singlePkgDir = await mkdtemp(join(tmpdir(), "vitest-agent-single-"));
			try {
				await writeFile(
					join(singlePkgDir, "package.json"),
					JSON.stringify({ name: "single-pkg", version: "0.0.0", workspaces: ["."] }),
				);
				await mkdir(join(singlePkgDir, "src"), { recursive: true });
				await writeFile(join(singlePkgDir, "src", "foo.test.ts"), "");

				// When: discoverProjects is called
				const { projects } = await discoverProjects({ cwd: singlePkgDir });

				// Then: one project is returned named after the package.
				// The root package has relativePath === "." — the old code skipped it;
				// the new unified algorithm does not (strategy.buildProject decides).
				expect(projects).toHaveLength(1);
				expect(projects?.[0].test?.name).toBe("single-pkg");
			} finally {
				await rm(singlePkgDir, { recursive: true, force: true });
			}
		});

		it("should return one project for a test-only package with no src/ (validates !isDir(srcDir) skip removal)", async () => {
			// Given: a package in tmp workspace with __test__/ only, no src/
			const pkgDir = join(tmpDir, "packages", "test-only");
			await mkdir(join(pkgDir, "__test__"), { recursive: true });
			await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/test-only", version: "0.0.0" }));
			await writeFile(join(pkgDir, "__test__", "foo.test.ts"), "");

			// When: discoverProjects is called
			const { projects } = await discoverProjects({ cwd: tmpDir });

			// Then: one project is returned with __test__ in its include patterns
			expect(projects).toHaveLength(1);
			expect(projects?.[0].test?.name).toBe("@test/test-only");
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		});

		it("should return projects: undefined for a workspace with no packages that have tests", async () => {
			// Given: workspace with a package that has no test files
			const pkgDir = join(tmpDir, "packages", "no-tests");
			await mkdir(join(pkgDir, "src"), { recursive: true });
			await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/no-tests", version: "0.0.0" }));
			await writeFile(join(pkgDir, "src", "index.ts"), "export const x = 1;");

			// When: discoverProjects is called
			const result = await discoverProjects({ cwd: tmpDir });

			// Then: projects is undefined (not an empty array)
			expect(result.projects).toBeUndefined();
			// Tags are still returned
			expect(Array.isArray(result.tags)).toBe(true);
		});

		it("should return projects: undefined and empty tags when custom strategy finds nothing", async () => {
			// Given: a custom strategy that always returns null
			const myStrategy = DiscoverStrategy.create({
				tags: [],
				buildProject: async () => null,
				classify: () => [],
			});
			await createPkg("some-pkg", { hasUnit: true });

			// When: discoverProjects is called with the custom strategy
			const result = await discoverProjects({ strategy: myStrategy, cwd: tmpDir });

			// Then: projects is undefined, tags is empty
			expect(result.projects).toBeUndefined();
			expect(result.tags).toEqual([]);
		});

		it("should return the same object reference on second no-arg call (process cache)", async () => {
			// Given: a workspace with a test package — but we use this real workspace
			// to avoid any tmp-dir cache key pollution. Two calls with no args, same cwd.
			const result1 = await discoverProjects({ cwd: tmpDir });
			const result2 = await discoverProjects({ cwd: tmpDir });

			// Then: same reference (cache hit)
			expect(result1).toBe(result2);
		});

		it("should NOT cache when a strategy is passed explicitly", async () => {
			// Given: the same workspace root with an explicit strategy
			const myStrategy = DiscoverStrategy.create({
				tags: [],
				buildProject: async () => null,
				classify: () => [],
			});
			await createPkg("some-pkg2", { hasUnit: true });

			const result1 = await discoverProjects({ strategy: myStrategy, cwd: tmpDir });
			const result2 = await discoverProjects({ strategy: myStrategy, cwd: tmpDir });

			// Then: different references (not cached)
			expect(result1).not.toBe(result2);
		});
	});

	describe("cache invalidation via directory signature (issue #100)", () => {
		// Behavior 1 (TDD): asserts the cached result is invalidated when the on-disk test-file set changes.
		it("should reflect a newly-added test file after the on-disk set changes following an initial cached call", async () => {
			// Given: a package with a single src/ unit test, discovered once (populates the process cache)
			await createPkg("stale-cache", { hasUnit: true });
			const first = await discoverProjects({ cwd: tmpDir });
			const firstInclude = first.projects?.[0].test?.include as string[] | undefined;
			expect(firstInclude?.some((p) => p.includes("__test__/"))).toBe(false);

			// When: a new test file is added under __test__/ after the first (cached) call
			await mkdir(join(tmpDir, "packages", "stale-cache", "__test__"), { recursive: true });
			await writeFile(join(tmpDir, "packages", "stale-cache", "__test__", "extra.test.ts"), "");
			const second = await discoverProjects({ cwd: tmpDir });

			// Then: the second call reflects the new file set instead of the stale first result
			const secondInclude = second.projects?.[0].test?.include as string[] | undefined;
			expect(secondInclude?.some((p) => p.includes("__test__/"))).toBe(true);
			expect(second).not.toBe(first);
		});
	});
});
