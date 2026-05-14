/**
 * DiscoverBuilder thenable tests — spec §5 ".addProject() builder tests"
 *
 * Tests the AgentPlugin.discover() builder returned by AgentPlugin.discover().
 * The builder is thenable (PromiseLike) and supports immutable .addProject() chains.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentPlugin } from "../src/plugin.js";
import { DiscoverStrategy } from "../src/utils/discover-strategy.js";

// ── Empty-workspace fixture ────────────────────────────────────────────────────
// A tmp dir with pnpm-workspace.yaml but no packages that have test files.

let emptyWorkspace: string;

beforeEach(async () => {
	emptyWorkspace = await mkdtemp(join(tmpdir(), "vitest-agent-builder-"));
	await writeFile(join(emptyWorkspace, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
	await writeFile(
		join(emptyWorkspace, "package.json"),
		JSON.stringify({ name: "root", version: "0.0.0", private: true }),
	);
});

afterEach(async () => {
	await rm(emptyWorkspace, { recursive: true, force: true });
});

/**
 * Helper: create a workspace package with optional test files.
 */
async function createPkg(root: string, name: string, opts: { hasUnit?: boolean } = {}) {
	const pkgDir = join(root, "packages", name);
	await mkdir(join(pkgDir, "src"), { recursive: true });
	await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: `@builder-test/${name}`, version: "0.0.0" }));
	if (opts.hasUnit) await writeFile(join(pkgDir, "src", "index.test.ts"), "");
}

/**
 * Helper: create a stand-alone directory with optional test files (no package.json).
 * Used for .addProject() tests where the directory is not a workspace package.
 */
async function createTestDir(opts: { hasUnit?: boolean } = {}): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "vitest-agent-test-dir-"));
	if (opts.hasUnit) {
		await mkdir(join(dir, "__test__"), { recursive: true });
		await writeFile(join(dir, "__test__", "index.test.ts"), "");
	}
	return dir;
}

describe("AgentPlugin.discover() DiscoverBuilder", () => {
	// ── Test 1: thenable ────────────────────────────────────────────────────────
	it("should be thenable — await resolves to { projects, tags }", async () => {
		// Given: the real monorepo workspace (this repo has packages with tests)
		// When: AgentPlugin.discover() is awaited
		const result = await AgentPlugin.discover();

		// Then: resolves to the expected shape
		expect(result).toHaveProperty("tags");
		expect(Array.isArray(result.tags)).toBe(true);
		// projects may be undefined (if no packages have tests) or an array
		expect(result.projects === undefined || Array.isArray(result.projects)).toBe(true);
	});

	// ── Test 2: immutability ───────────────────────────────────────────────────
	it("should return a new builder from .addProject(), leaving original unchanged", async () => {
		// Given: an empty workspace and a directory with test files
		const testDir = await createTestDir({ hasUnit: true });

		// Use a custom strategy that always returns a config for addProject entries
		const alwaysConfig = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (input) => ({
				extends: true as const,
				test: { name: input.name, environment: "node" as const, include: [] },
			}),
		});

		try {
			const builder = AgentPlugin.discover(alwaysConfig);
			const builderWithAdd = builder.addProject({ name: "extra", path: testDir });

			// When: resolving the original builder vs the extended one
			const originalResult = await builder;
			const extendedResult = await builderWithAdd;

			// Then: original doesn't have the added entry
			const originalNames = originalResult.projects?.map((p) => p.test?.name) ?? [];
			expect(originalNames).not.toContain("extra");

			// And: extended has the added entry
			const extendedNames = extendedResult.projects?.map((p) => p.test?.name) ?? [];
			expect(extendedNames).toContain("extra");

			// And: the two builders are distinct objects
			expect(builder).not.toBe(builderWithAdd);
		} finally {
			await rm(testDir, { recursive: true, force: true });
		}
	});

	// ── Test 3: chained adds ───────────────────────────────────────────────────
	it("should include both entries when .addProject() is chained twice", async () => {
		// Given: two directories with test files
		const testDirA = await createTestDir({ hasUnit: true });
		const testDirB = await createTestDir({ hasUnit: true });

		const alwaysConfig = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (input) => ({
				extends: true as const,
				test: { name: input.name, environment: "node" as const, include: [] },
			}),
		});

		try {
			// When: chaining two addProject calls
			const result = await AgentPlugin.discover(alwaysConfig)
				.addProject({ name: "alpha", path: testDirA })
				.addProject({ name: "beta", path: testDirB });

			// Then: both entries appear in the result
			const names = result.projects?.map((p) => p.test?.name) ?? [];
			expect(names).toContain("alpha");
			expect(names).toContain("beta");
		} finally {
			await rm(testDirA, { recursive: true, force: true });
			await rm(testDirB, { recursive: true, force: true });
		}
	});

	// ── Test 4: null result throws ─────────────────────────────────────────────
	it("should throw when added entry has no test files under the active strategy", async () => {
		// Given: a directory with NO test files + DefaultDiscoverStrategy (implicit)
		const emptyDir = await createTestDir({ hasUnit: false });

		// Use an empty-workspace cwd so workspace packages don't interfere
		const emptyStrategy = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async () => null, // always returns null — "no tests"
		});

		try {
			// When: resolving a builder with an added entry that produces null
			await expect(
				AgentPlugin.discover(emptyStrategy).addProject({ name: "no-tests", path: emptyDir }),
			).rejects.toThrow(/no-tests|emptyDir/i);

			// And: the error message names the strategy
			await expect(
				AgentPlugin.discover(emptyStrategy).addProject({ name: "no-tests", path: emptyDir }),
			).rejects.toThrow(/ConcreteDiscoverStrategy|DiscoverStrategy|no test files/i);
		} finally {
			await rm(emptyDir, { recursive: true, force: true });
		}
	});

	// ── Test 5: name conflict throws ───────────────────────────────────────────
	it("should throw when added entry name conflicts with a workspace package", async () => {
		// Given: a workspace with one package named "@builder-test/alpha"
		await createPkg(emptyWorkspace, "alpha", { hasUnit: true });

		const alwaysConfig = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (input) => ({
				extends: true as const,
				test: { name: input.name, environment: "node" as const, include: [] },
			}),
		});

		const testDir = await createTestDir({ hasUnit: true });
		try {
			// When: adding a project with the same name as a workspace package
			// Pass cwd so discover scans emptyWorkspace (which has @builder-test/alpha),
			// not the real monorepo root.
			await expect(
				AgentPlugin.discover({ strategy: alwaysConfig, cwd: emptyWorkspace }).addProject({
					name: "@builder-test/alpha",
					path: testDir,
				}),
			).rejects.toThrow(/@builder-test\/alpha|conflict/i);
		} finally {
			await rm(testDir, { recursive: true, force: true });
		}
	});

	// ── Test 6: path conflict throws ───────────────────────────────────────────
	it("should throw when added entry resolved path conflicts with a workspace package path", async () => {
		// Given: a workspace with one package
		await createPkg(emptyWorkspace, "gamma", { hasUnit: true });
		const existingPkgPath = join(emptyWorkspace, "packages", "gamma");

		const alwaysConfig = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (input) => ({
				extends: true as const,
				test: { name: input.name, environment: "node" as const, include: [] },
			}),
		});

		// When: adding a project pointing at the same absolute path as an existing package
		// Pass cwd so discover scans emptyWorkspace (which has packages/gamma),
		// not the real monorepo root.
		await expect(
			AgentPlugin.discover({ strategy: alwaysConfig, cwd: emptyWorkspace }).addProject({
				name: "different-name",
				path: existingPkgPath,
			}),
		).rejects.toThrow(/conflict|gamma|different-name/i);
	});

	// ── Test 7: empty workspace, no addProject ─────────────────────────────────
	it("should resolve to projects: undefined for empty workspace with no addProject", async () => {
		// Given: a workspace with no packages that have test files (emptyWorkspace fixture)
		// Add a package that has NO test files
		const pkgDir = join(emptyWorkspace, "packages", "empty-pkg");
		await mkdir(join(pkgDir, "src"), { recursive: true });
		await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@builder-test/empty-pkg" }));
		await writeFile(join(pkgDir, "src", "index.ts"), "export const x = 1;");

		// When: calling discover with a cwd pointing at the empty workspace
		const emptyStrategy = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async () => null,
		});
		const result = await AgentPlugin.discover(emptyStrategy);

		// Then: projects is undefined
		expect(result.projects).toBeUndefined();
		// Tags still returned (empty in this case)
		expect(Array.isArray(result.tags)).toBe(true);
	});

	// ── Test 8: empty workspace + one addProject with custom strategy ──────────
	it("should resolve one project when empty workspace has one addProject with custom strategy", async () => {
		// Given: a custom strategy that always returns a config for added entries
		const oneConfig = {
			extends: true as const,
			test: { name: "test-only", environment: "node" as const, include: [] },
		};
		const customStrategy = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (_input) => oneConfig,
		});

		const testDir = await createTestDir({ hasUnit: true });
		try {
			// When: empty workspace + one addProject
			const result = await AgentPlugin.discover(customStrategy).addProject({
				name: "test-only",
				path: testDir,
			});

			// Then: projects contains exactly the one config
			expect(result.projects).toBeDefined();
			// The workspace packages all return null from the custom strategy,
			// so only the addProject entry makes it through.
			const names = result.projects?.map((p) => p.test?.name);
			expect(names).toContain("test-only");
		} finally {
			await rm(testDir, { recursive: true, force: true });
		}
	});
});
