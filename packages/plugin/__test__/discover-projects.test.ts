import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_DIR } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";

// Widens the async window inside the declined-package warning so the
// check-then-act race on the warn-once Set is deterministic rather than
// dependent on how two real scans happen to interleave. `probeDelayMs` is 0
// for every other test, which delegates straight to the real predicate.
const probeControl = vi.hoisted(() => ({ probeDelayMs: 0 }));
vi.mock("../src/utils/is-test-shaped-package.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/is-test-shaped-package.js")>();
	return {
		...actual,
		isTestShapedPackage: async (pkgPath: string): Promise<boolean> => {
			if (probeControl.probeDelayMs > 0) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, probeControl.probeDelayMs));
			}
			return actual.isTestShapedPackage(pkgPath);
		},
	};
});

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
			const pkgDir = join(tmpDir, "packages", "td-excl");
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "**", "utils", "**"))).toBe(true);
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "**", "fixtures", "**"))).toBe(true);
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "**", "snapshots", "**"))).toBe(true);
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

// Re-authored inside the active red phase window (D2 evidence binding).
describe("declined-package warning (issue #229)", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		stderrSpy.mockRestore();
	});

	function stderrMessages(): string[] {
		return stderrSpy.mock.calls.map((call: unknown[]) => String(call[0]));
	}

	it("warns once naming the package and the check-test-path probe when a test-shaped package is declined", async () => {
		// Given: a package whose __test__/ dir exists but holds no matching test
		// files — buildProject declines it (returns null) even though the
		// directory signals test intent.
		const pkgDir = join(tmpDir, "packages", "warn-me");
		await mkdir(join(pkgDir, "__test__"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/warn-me", version: "0.0.0" }));
		await writeFile(join(pkgDir, "__test__", "helper.ts"), "");

		// When: discoverProjects is called
		const { projects } = await discoverProjects({ cwd: tmpDir });

		// Then: the package is still declined (no project), and a stderr warning
		// names the package and points at the diagnostic probe.
		expect(projects === undefined || projects.every((p) => p.test?.name !== "@test/warn-me")).toBe(true);
		const calls = stderrMessages();
		const warning = calls.find((c) => c.includes("@test/warn-me"));
		expect(warning).toBeDefined();
		expect(warning).toContain("check-test-path");
	});

	it("does not warn for a package that legitimately has no tests", async () => {
		// Given: a package with src/ but no test-named file, and no __test__/ dir —
		// a perfectly ordinary non-test-shaped package.
		const pkgDir = join(tmpDir, "packages", "no-tests-legit");
		await mkdir(join(pkgDir, "src"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/no-tests-legit", version: "0.0.0" }));
		await writeFile(join(pkgDir, "src", "index.ts"), "export const x = 1;");

		// When: discoverProjects is called
		await discoverProjects({ cwd: tmpDir });

		// Then: no warning mentions this package
		const calls = stderrMessages();
		expect(calls.some((c) => c.includes("@test/no-tests-legit"))).toBe(false);
	});

	it("warns at most once per package across repeated discoverProjects() calls", async () => {
		// Given: the same declined, test-shaped package as above, with a custom
		// strategy passed explicitly so the process-level result cache never
		// short-circuits repeated calls into the packages loop.
		const pkgDir = join(tmpDir, "packages", "warn-once");
		await mkdir(join(pkgDir, "__test__"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/warn-once", version: "0.0.0" }));
		await writeFile(join(pkgDir, "__test__", "helper.ts"), "");
		const strategy = new DefaultDiscoverStrategy();

		// When: discoverProjects is called twice in a row
		await discoverProjects({ strategy, cwd: tmpDir });
		await discoverProjects({ strategy, cwd: tmpDir });

		// Then: exactly one warning mentions this package, not two
		const calls = stderrMessages();
		const matches = calls.filter((c) => c.includes("@test/warn-once"));
		expect(matches).toHaveLength(1);
	});

	it("warns at most once per package when two discoverProjects() calls run concurrently", async () => {
		// Given: a declined, test-shaped package. The dedup Set is consulted and
		// written on opposite sides of the async isTestShapedPackage() probe, so
		// two overlapping scans can both pass the `has()` guard before either
		// records the path — the classic check-then-act race.
		const pkgDir = join(tmpDir, "packages", "warn-concurrent");
		await mkdir(join(pkgDir, "__test__"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/warn-concurrent", version: "0.0.0" }));
		await writeFile(join(pkgDir, "__test__", "helper.ts"), "");
		const strategy = new DefaultDiscoverStrategy();

		// When: two scans run concurrently (the MCP server re-resolves discovery
		// while a Vitest config load is already in flight). The probe is slowed
		// so the second scan is guaranteed to reach the dedup guard while the
		// first is still suspended inside it.
		probeControl.probeDelayMs = 100;
		try {
			await Promise.all([discoverProjects({ strategy, cwd: tmpDir }), discoverProjects({ strategy, cwd: tmpDir })]);
		} finally {
			probeControl.probeDelayMs = 0;
		}

		// Then: exactly one warning mentions this package, not two
		const calls = stderrMessages();
		const matches = calls.filter((c) => c.includes("@test/warn-concurrent"));
		expect(matches).toHaveLength(1);
	});
});
