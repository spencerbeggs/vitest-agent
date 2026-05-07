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
	it("discovers a package with only unit tests", async () => {
		await createPkg("alpha", { hasUnit: true });
		const projects = await discoverProjects(undefined, tmpDir);
		expect(projects).toHaveLength(1);
		expect(projects[0].name).toBe("@test/alpha");
		expect(projects[0].kind).toBe("unit");
	});

	it("uses bare name when only one kind of test exists", async () => {
		await createPkg("beta", { hasInt: true });
		const projects = await discoverProjects(undefined, tmpDir);
		expect(projects[0].name).toBe("@test/beta");
	});

	it("suffixes names when multiple kinds exist in one package", async () => {
		await createPkg("gamma", { hasUnit: true, hasInt: true });
		const names = (await discoverProjects(undefined, tmpDir)).map((p) => p.name);
		expect(names).toContain("@test/gamma:unit");
		expect(names).toContain("@test/gamma:int");
	});

	it("discovers all three kinds when present", async () => {
		await createPkg("delta", { hasUnit: true, hasInt: true, hasE2e: true });
		const projects = await discoverProjects(undefined, tmpDir);
		const names = projects.map((p) => p.name);
		expect(names).toContain("@test/delta:unit");
		expect(names).toContain("@test/delta:int");
		expect(names).toContain("@test/delta:e2e");
	});

	it("skips packages without a src/ directory", async () => {
		const pkgDir = join(tmpDir, "packages", "no-src");
		await mkdir(pkgDir, { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@test/no-src", version: "0.0.0" }));
		const projects = await discoverProjects(undefined, tmpDir);
		expect(projects.every((p) => p.name !== "@test/no-src")).toBe(true);
	});

	it("emits a unit placeholder when src/ exists but no test files found", async () => {
		await createPkg("empty");
		const projects = await discoverProjects(undefined, tmpDir);
		expect(projects).toHaveLength(1);
		expect(projects[0].kind).toBe("unit");
	});

	it("wires setupFiles when vitest.setup.ts exists at package root", async () => {
		await createPkg("setup-pkg", { hasUnit: true, setupFile: true });
		const projects = await discoverProjects(undefined, tmpDir);
		const cfg = projects[0].toConfig();
		expect(cfg.test?.setupFiles).toBeDefined();
		expect((cfg.test?.setupFiles as string[]).some((f) => f.includes("vitest.setup.ts"))).toBe(true);
	});

	it("applies object override to all projects of a kind", async () => {
		await createPkg("override-test", { hasUnit: true });
		const projects = await discoverProjects({ unit: { environment: "jsdom" } }, tmpDir);
		expect(projects[0].toConfig().test?.environment).toBe("jsdom");
	});

	it("applies callback override by kind", async () => {
		await createPkg("cb-test", { hasInt: true });
		const projects = await discoverProjects(
			{
				int: (map) => {
					map.get("@test/cb-test")?.override({ test: { testTimeout: 99_000 } });
				},
			},
			tmpDir,
		);
		expect(projects[0].toConfig().test?.testTimeout).toBe(99_000);
	});

	it("applies top-level callback receiving all projects", async () => {
		await createPkg("top-cb", { hasUnit: true });
		const projects = await discoverProjects(({ projects }) => {
			projects[0].override({ test: { environment: "jsdom" } });
		}, tmpDir);
		expect(projects[0].toConfig().test?.environment).toBe("jsdom");
	});

	it("throws when workspace root cannot be found", async () => {
		await expect(discoverProjects(undefined, "/tmp/no-workspace-" + Date.now())).rejects.toThrow();
	});

	describe("__test__/ directory support", () => {
		it("discovers unit tests in __test__/", async () => {
			await createPkg("td-unit", { testDirUnit: true });
			const projects = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("unit");
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("__test__"))).toBe(true);
		});

		it("discovers int tests in __test__/integration/", async () => {
			await createPkg("td-int", { testDirInt: true });
			const projects = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("int");
		});

		it("discovers e2e tests in __test__/e2e/", async () => {
			await createPkg("td-e2e", { testDirE2e: true });
			const projects = await discoverProjects(undefined, tmpDir);
			expect(projects).toHaveLength(1);
			expect(projects[0].kind).toBe("e2e");
		});

		it("merges test kinds across src/ and __test__/", async () => {
			// unit in src/, int in __test__/
			await createPkg("td-merge", { hasUnit: true, testDirInt: true });
			const names = (await discoverProjects(undefined, tmpDir)).map((p) => p.name);
			expect(names).toContain("@test/td-merge:unit");
			expect(names).toContain("@test/td-merge:int");
		});

		it("include patterns reference both src/ and __test__/", async () => {
			await createPkg("td-both", { hasUnit: true, testDirUnit: true });
			const projects = await discoverProjects(undefined, tmpDir);
			const include = projects[0].toConfig().test?.include as string[];
			expect(include.some((p) => p.includes("/src/"))).toBe(true);
			expect(include.some((p) => p.includes("/__test__/"))).toBe(true);
		});

		it("excludes utils/ fixtures/ snapshots/ inside __test__/", async () => {
			await createPkg("td-excl", { testDirUnit: true });
			const projects = await discoverProjects(undefined, tmpDir);
			const exclude = projects[0].toConfig().test?.exclude as string[] | undefined;
			expect(exclude).toBeDefined();
			expect(exclude!.some((p) => p.includes("__test__/utils"))).toBe(true);
			expect(exclude!.some((p) => p.includes("__test__/fixtures"))).toBe(true);
			expect(exclude!.some((p) => p.includes("__test__/snapshots"))).toBe(true);
		});
	});
});
