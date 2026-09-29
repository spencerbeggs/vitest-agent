import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_DIR } from "@vitest-agent/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import type { WalkerFileSystem } from "../src/utils/walker-fs.js";
import type { MemfsWorkspace } from "./utils/memfs-workspace.js";
import { makeMemfsWorkspace, uniqueRoot } from "./utils/memfs-workspace.js";

// Widens the async window inside the declined-package warning so the
// check-then-act race on the warn-once Set is deterministic rather than
// dependent on how two scans happen to interleave. `probeDelayMs` is 0 for
// every other test, which delegates straight to the real predicate. The `fs`
// port must be forwarded: dropping it would silently probe the real disk
// instead of the test's virtual volume.
const probeControl = vi.hoisted(() => ({ probeDelayMs: 0 }));
vi.mock("../src/utils/is-test-shaped-package.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/is-test-shaped-package.js")>();
	return {
		...actual,
		isTestShapedPackage: async (pkgPath: string, fs?: WalkerFileSystem): Promise<boolean> => {
			if (probeControl.probeDelayMs > 0) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, probeControl.probeDelayMs));
			}
			return actual.isTestShapedPackage(pkgPath, fs);
		},
	};
});

interface PkgOptions {
	hasUnit?: boolean;
	hasInt?: boolean;
	hasE2e?: boolean;
	setupFile?: boolean;
	// Place test files in __test__/ instead of src/
	testDirUnit?: boolean;
	testDirInt?: boolean;
	testDirE2e?: boolean;
}

const ROOT_FILES = {
	"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
};

/** The seed entries (relative to the workspace root) for one package. */
function pkgFiles(name: string, opts: PkgOptions = {}): Record<string, string> {
	const dir = `packages/${name}`;
	const files: Record<string, string> = {
		[`${dir}/package.json`]: JSON.stringify({ name: `@test/${name}`, version: "0.0.0" }),
		[`${dir}/src/index.ts`]: "",
	};
	if (opts.hasUnit) files[`${dir}/src/index.test.ts`] = "";
	if (opts.hasInt) files[`${dir}/src/index.int.test.ts`] = "";
	if (opts.hasE2e) files[`${dir}/src/index.e2e.test.ts`] = "";
	if (opts.setupFile) files[`${dir}/vitest.setup.ts`] = "";
	if (opts.testDirUnit) files[`${dir}/__test__/index.test.ts`] = "";
	if (opts.testDirInt) files[`${dir}/__test__/integration/index.int.test.ts`] = "";
	if (opts.testDirE2e) files[`${dir}/__test__/e2e/index.e2e.test.ts`] = "";
	return files;
}

/** A pnpm workspace root holding `extra` files alongside the root manifests. */
const workspace = (extra: Record<string, string> = {}): Promise<MemfsWorkspace> =>
	makeMemfsWorkspace({ ...ROOT_FILES, ...extra });

/** A workspace with one package that has a `__test__/` dir but no matching test file. */
const declinedTestShaped = (name: string): Promise<MemfsWorkspace> =>
	workspace({
		[`packages/${name}/package.json`]: JSON.stringify({ name: `@test/${name}`, version: "0.0.0" }),
		[`packages/${name}/__test__/helper.ts`]: "",
	});

/** A workspace with one ordinary package: src/ but no test-named file. */
const noTestsPkg = (name: string): Promise<MemfsWorkspace> =>
	workspace({
		[`packages/${name}/package.json`]: JSON.stringify({ name: `@test/${name}`, version: "0.0.0" }),
		[`packages/${name}/src/index.ts`]: "export const x = 1;",
	});

describe("discoverProjects()", () => {
	it("should accept an options-bag { cwd } and behave identically to positional call", async () => {
		// Given: a package with a unit test
		const ws = await workspace(pkgFiles("opts-bag", { hasUnit: true }));

		// When: discoverProjects is called with the options-bag signature
		const { projects } = await ws.discover();

		// Then: it resolves one project named after the package
		expect(projects).toHaveLength(1);
		expect(projects?.[0].test?.name).toBe("@test/opts-bag");
	});

	it("should return TestProjectInlineConfiguration objects directly (not VitestProject)", async () => {
		// Given: a package with a unit test
		const ws = await workspace(pkgFiles("alpha", { hasUnit: true }));

		// When: discoverProjects is called
		const { projects } = await ws.discover();

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
		const ws = await workspace(pkgFiles("beta", { hasInt: true }));
		const { projects } = await ws.discover();
		expect(projects?.[0].test?.name).toBe("@test/beta");
	});

	it("should skip packages with no test files (strategy returns null)", async () => {
		const ws = await noTestsPkg("no-tests");
		const { projects } = await ws.discover();
		expect(projects === undefined || projects.every((p) => p.test?.name !== "@test/no-tests")).toBe(true);
	});

	it("should wire setupFiles when vitest.setup.ts exists at package root", async () => {
		const ws = await workspace(pkgFiles("setup-pkg", { hasUnit: true, setupFile: true }));
		const { projects } = await ws.discover();
		const p = projects?.[0];
		expect(p?.test?.setupFiles).toBeDefined();
		expect((p?.test?.setupFiles as string[] | undefined)?.some((f) => f.includes("vitest.setup.ts"))).toBe(true);
	});

	it("should throw when workspace root cannot be found", async () => {
		// An empty volume: nothing above cwd marks a workspace root.
		const ws = await makeMemfsWorkspace({});
		await expect(ws.discover({ cwd: `${ws.root}/nested/dir` })).rejects.toThrow(/Could not find workspace root/);
	});

	describe("__test__/ directory support", () => {
		it("should include __test__/ glob when __test__/ has test files", async () => {
			const ws = await workspace(pkgFiles("td-unit", { testDirUnit: true }));
			const { projects } = await ws.discover();
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include int test files via __test__/ glob", async () => {
			const ws = await workspace(pkgFiles("td-int", { testDirInt: true }));
			const { projects } = await ws.discover();
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include e2e test files via __test__/ glob", async () => {
			const ws = await workspace(pkgFiles("td-e2e", { testDirE2e: true }));
			const { projects } = await ws.discover();
			expect(projects).toHaveLength(1);
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("should include patterns for both src/ and __test__/", async () => {
			const ws = await workspace(pkgFiles("td-both", { hasUnit: true, testDirUnit: true }));
			const { projects } = await ws.discover();
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("src/"))).toBe(true);
			expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		});

		it("should exclude utils/ fixtures/ snapshots/ inside __test__/", async () => {
			const ws = await workspace(pkgFiles("td-excl", { testDirUnit: true }));
			const { projects } = await ws.discover();
			const exclude = projects?.[0].test?.exclude as string[] | undefined;
			expect(exclude).toBeDefined();
			const pkgDir = join(ws.root, "packages", "td-excl");
			// Anchored directly under __test__/ (the test root), not "**" away from
			// it — a same-named suite directory nested deeper (e.g.
			// __test__/unit/utils/) is not excluded (issue #251).
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "utils", "**"))).toBe(true);
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "fixtures", "**"))).toBe(true);
			expect(exclude?.some((p) => p === join(pkgDir, TEST_DIR, "snapshots", "**"))).toBe(true);
		});
	});

	describe("Phase 4: new fixtures (spec §5)", () => {
		it("should return one project for a single-package repo (validates relativePath==='.' skip removal)", async () => {
			// Given: a single-package root marked as a workspace root via a
			// `workspaces` field in package.json + src/foo.test.ts.
			// @effected/workspaces recognises a workspace root by a
			// pnpm-workspace.yaml or a package.json `workspaces` field — the
			// former `.git`-as-boundary heuristic of workspaces-effect@1.x was
			// dropped, so the root marker is now the self-referencing workspaces
			// field. The root package is still enumerated with relativePath ".".
			const ws = await makeMemfsWorkspace(
				{
					"package.json": JSON.stringify({ name: "single-pkg", version: "0.0.0", workspaces: ["."] }),
					"src/foo.test.ts": "",
				},
				uniqueRoot("single"),
			);

			// When: discoverProjects is called
			const { projects } = await ws.discover();

			// Then: one project is returned named after the package.
			// The root package has relativePath === "." — the old code skipped it;
			// the unified algorithm does not (strategy.buildProject decides).
			expect(projects).toHaveLength(1);
			expect(projects?.[0].test?.name).toBe("single-pkg");
		});

		it("should return one project for a test-only package with no src/ (validates !isDir(srcDir) skip removal)", async () => {
			// Given: a package with __test__/ only, no src/
			const ws = await workspace({
				"packages/test-only/package.json": JSON.stringify({ name: "@test/test-only", version: "0.0.0" }),
				"packages/test-only/__test__/foo.test.ts": "",
			});

			// When: discoverProjects is called
			const { projects } = await ws.discover();

			// Then: one project is returned with __test__ in its include patterns
			expect(projects).toHaveLength(1);
			expect(projects?.[0].test?.name).toBe("@test/test-only");
			const include = projects?.[0].test?.include as string[];
			expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		});

		it("should return projects: undefined for a workspace with no packages that have tests", async () => {
			// Given: workspace with a package that has no test files
			const ws = await noTestsPkg("no-tests");

			// When: discoverProjects is called
			const result = await ws.discover();

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
			const ws = await workspace(pkgFiles("some-pkg", { hasUnit: true }));

			// Declining a test-shaped package fires the issue-#229 stderr warning
			// by design; capture it so it doesn't leak into the run output.
			const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
			try {
				// When: discoverProjects is called with the custom strategy
				const result = await ws.discover({ strategy: myStrategy });

				// Then: projects is undefined, tags is empty
				expect(result.projects).toBeUndefined();
				expect(result.tags).toEqual([]);
			} finally {
				stderrSpy.mockRestore();
			}
		});

		it("should return the same object reference on second no-arg call (process cache)", async () => {
			// Given: an unchanged workspace. Two calls with no strategy, same cwd.
			const ws = await workspace(pkgFiles("cached", { hasUnit: true }));
			const result1 = await ws.discover();
			const result2 = await ws.discover();

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
			const ws = await workspace(pkgFiles("some-pkg2", { hasUnit: true }));

			// Declining a test-shaped package fires the issue-#229 stderr warning
			// by design; capture it so it doesn't leak into the run output.
			const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
			try {
				const result1 = await ws.discover({ strategy: myStrategy });
				const result2 = await ws.discover({ strategy: myStrategy });

				// Then: different references (not cached)
				expect(result1).not.toBe(result2);
			} finally {
				stderrSpy.mockRestore();
			}
		});
	});

	describe("cache invalidation via directory signature (issue #100)", () => {
		it("should reflect a newly-added test file after the test-file set changes following an initial cached call", async () => {
			// Given: a package with a single src/ unit test, discovered once (populates the process cache)
			const ws = await workspace(pkgFiles("stale-cache", { hasUnit: true }));
			const first = await ws.discover();
			const firstInclude = first.projects?.[0].test?.include as string[] | undefined;
			expect(firstInclude?.some((p) => p.includes("__test__/"))).toBe(false);

			// When: a new test file is added under __test__/ after the first (cached) call
			await ws.write("packages/stale-cache/__test__/extra.test.ts");
			const second = await ws.discover();

			// Then: the second call reflects the new file set instead of the stale first result
			const secondInclude = second.projects?.[0].test?.include as string[] | undefined;
			expect(secondInclude?.some((p) => p.includes("__test__/"))).toBe(true);
			expect(second).not.toBe(first);
		});
	});
});

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
		const ws = await declinedTestShaped("warn-me");

		// When: discoverProjects is called
		const { projects } = await ws.discover();

		// Then: the package is still declined (no project), and a stderr warning
		// names the package and points at the diagnostic probe.
		expect(projects === undefined || projects.every((p) => p.test?.name !== "@test/warn-me")).toBe(true);
		const warning = stderrMessages().find((c) => c.includes("@test/warn-me"));
		expect(warning).toBeDefined();
		expect(warning).toContain("check-test-path");
	});

	it("does not warn for a package that legitimately has no tests", async () => {
		// Given: a package with src/ but no test-named file, and no __test__/ dir —
		// a perfectly ordinary non-test-shaped package.
		const ws = await noTestsPkg("no-tests-legit");

		// When: discoverProjects is called
		await ws.discover();

		// Then: no warning mentions this package
		expect(stderrMessages().some((c) => c.includes("@test/no-tests-legit"))).toBe(false);
	});

	it("warns at most once per package across repeated discoverProjects() calls", async () => {
		// Given: the same declined, test-shaped package as above, with a custom
		// strategy passed explicitly so the process-level result cache never
		// short-circuits repeated calls into the packages loop.
		const ws = await declinedTestShaped("warn-once");
		const strategy = new DefaultDiscoverStrategy();

		// When: discoverProjects is called twice in a row
		await ws.discover({ strategy });
		await ws.discover({ strategy });

		// Then: exactly one warning mentions this package, not two
		expect(stderrMessages().filter((c) => c.includes("@test/warn-once"))).toHaveLength(1);
	});

	it("warns at most once per package when two discoverProjects() calls run concurrently", async () => {
		// Given: a declined, test-shaped package. The dedup Set is consulted and
		// written on opposite sides of the async isTestShapedPackage() probe, so
		// two overlapping scans can both pass the `has()` guard before either
		// records the path — the classic check-then-act race.
		const ws = await declinedTestShaped("warn-concurrent");
		const strategy = new DefaultDiscoverStrategy();

		// When: two scans run concurrently (the MCP server re-resolves discovery
		// while a Vitest config load is already in flight). The probe is slowed
		// so the second scan is guaranteed to reach the dedup guard while the
		// first is still suspended inside it.
		probeControl.probeDelayMs = 100;
		try {
			await Promise.all([ws.discover({ strategy }), ws.discover({ strategy })]);
		} finally {
			probeControl.probeDelayMs = 0;
		}

		// Then: exactly one warning mentions this package, not two
		expect(stderrMessages().filter((c) => c.includes("@test/warn-concurrent"))).toHaveLength(1);
	});
});

// Every case above runs on a virtual volume through the injected ports. This
// one keeps the default `node:fs` bindings honest end to end: no `fs`, no
// `syncOps`, a real temporary workspace.
describe("discoverProjects() on the real filesystem (smoke)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-discover-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("discovers src/ and __test__/ tests and a setup file through the default node ports", async () => {
		const pkgDir = join(tmpDir, "packages", "real");
		await writeFile(join(tmpDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
		await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
		await mkdir(join(pkgDir, "src"), { recursive: true });
		await mkdir(join(pkgDir, "__test__"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/real", version: "0.0.0" }));
		await writeFile(join(pkgDir, "src", "index.test.ts"), "");
		await writeFile(join(pkgDir, "__test__", "index.test.ts"), "");
		await writeFile(join(pkgDir, "vitest.setup.ts"), "");

		const { projects } = await discoverProjects({ cwd: tmpDir });

		expect(projects?.map((p) => p.test?.name)).toEqual(["@test/real"]);
		const include = projects?.[0].test?.include as string[];
		expect(include.some((p) => p.includes("src/"))).toBe(true);
		expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		expect((projects?.[0].test?.setupFiles as string[] | undefined)?.some((f) => f.endsWith("vitest.setup.ts"))).toBe(
			true,
		);
	});
});
