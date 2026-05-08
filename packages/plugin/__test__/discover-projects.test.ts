import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";

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
	// Updated: destructure { projects } from the new return shape.
	it("discovers a package with only unit tests", async () => {
		await createPkg("alpha", { hasUnit: true });
		const { projects } = await discoverProjects(undefined, tmpDir);
		expect(projects).toHaveLength(1);
		expect(projects[0].name).toBe("@test/alpha");
		expect(projects[0].kind).toBe("unit");
	});

	// Updated: consolidated approach always uses bare package name.
	it("uses bare name for any test kind", async () => {
		await createPkg("beta", { hasInt: true });
		const { projects } = await discoverProjects(undefined, tmpDir);
		expect(projects[0].name).toBe("@test/beta");
	});

	// DELETED: "suffixes names when multiple kinds exist in one package"
	// — per-kind project split is removed; one project per package now.

	// DELETED: "discovers all three kinds when present"
	// — no longer emits three separate projects for unit/int/e2e.

	// Updated: destructure { projects } from the new return shape.
	it("skips packages without a src/ directory", async () => {
		const pkgDir = join(tmpDir, "packages", "no-src");
		await mkdir(pkgDir, { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/no-src", version: "0.0.0" }));
		const { projects } = await discoverProjects(undefined, tmpDir);
		expect(projects.every((p) => p.name !== "@test/no-src")).toBe(true);
	});

	// Updated: destructure { projects }; consolidated approach still emits a placeholder.
	it("emits a unit placeholder when src/ exists but no test files found", async () => {
		await createPkg("empty");
		const { projects } = await discoverProjects(undefined, tmpDir);
		expect(projects).toHaveLength(1);
		expect(projects[0].kind).toBe("unit");
	});

	// Updated: destructure { projects }.
	it("wires setupFiles when vitest.setup.ts exists at package root", async () => {
		await createPkg("setup-pkg", { hasUnit: true, setupFile: true });
		const { projects } = await discoverProjects(undefined, tmpDir);
		const cfg = projects[0].toConfig();
		expect(cfg.test?.setupFiles).toBeDefined();
		expect((cfg.test?.setupFiles as string[]).some((f) => f.includes("vitest.setup.ts"))).toBe(true);
	});

	// DELETED: "applies object override to all projects of a kind"
	// — per-kind override API ({ unit: ..., int: ..., e2e: ... }) is dropped.

	// DELETED: "applies callback override by kind"
	// — per-kind callback API is dropped.

	// Updated: destructure { projects }; top-level callback still works.
	it("applies top-level callback receiving all projects", async () => {
		await createPkg("top-cb", { hasUnit: true });
		const { projects } = await discoverProjects(({ projects }) => {
			projects[0].override({ test: { environment: "jsdom" } });
		}, tmpDir);
		expect(projects[0].toConfig().test?.environment).toBe("jsdom");
	});

	it("throws when workspace root cannot be found", async () => {
		await expect(discoverProjects(undefined, "/tmp/no-workspace-" + Date.now())).rejects.toThrow();
	});

	describe("__test__/ directory support", () => {
		// Updated: destructure { projects }; kind is always "unit" (consolidated).
		it("discovers unit tests in __test__/", async () => {
			await createPkg("td-unit", { testDirUnit: true });
			const { projects } = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("unit");
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		// Updated: int test files are now included via the combined glob in the
		// single consolidated project (kind is "unit" — classification is tag-based).
		it("discovers int test files via combined glob in __test__/", async () => {
			await createPkg("td-int", { testDirInt: true });
			const { projects } = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("unit");
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		// Updated: e2e test files are included via the combined glob; kind is "unit".
		it("discovers e2e test files via combined glob in __test__/", async () => {
			await createPkg("td-e2e", { testDirE2e: true });
			const { projects } = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("unit");
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		// DELETED: "merges test kinds across src/ and __test__/"
		// — no longer emits multiple projects for different kinds; one project covers all.

		// Updated: destructure { projects }.
		it("include patterns reference both src/ and __test__/", async () => {
			await createPkg("td-both", { hasUnit: true, testDirUnit: true });
			const { projects } = await discoverProjects(undefined, tmpDir);
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("/src/"))).toBe(true);
			expect(include.some((p) => p.includes("/__test__/"))).toBe(true);
		});

		// Updated: destructure { projects }.
		it("excludes utils/ fixtures/ snapshots/ inside __test__/", async () => {
			await createPkg("td-excl", { testDirUnit: true });
			const { projects } = await discoverProjects(undefined, tmpDir);
			const exclude = projects[0].toConfig().test?.exclude as string[] | undefined;
			expect(exclude).toBeDefined();
			expect(exclude!.some((p) => p.includes("__test__/utils"))).toBe(true);
			expect(exclude!.some((p) => p.includes("__test__/fixtures"))).toBe(true);
			expect(exclude!.some((p) => p.includes("__test__/snapshots"))).toBe(true);
		});
	});
});
