/**
 * DiscoverBuilder thenable tests — spec §5 ".addProject() builder tests"
 *
 * The builder semantics (thenable, immutable `.addProject()` chains, conflict
 * and null-config errors) are exercised through the internal
 * `makeDiscoverBuilder` over an `@effected/memfs` volume, so no case builds a
 * temp tree or scans the live monorepo. The public `AgentPlugin.discover`
 * wiring — its three argument forms and the forwarding of `strategy` / `cwd` /
 * `maxDepth` into the builder — stays covered by the real-disk / live-repo
 * cases in the last block, since the public options deliberately take no
 * filesystem port.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { describe, expect, it } from "vitest";
import type { DiscoverBuilder } from "../src/plugin.js";
import { AgentPlugin, makeDiscoverBuilder } from "../src/plugin.js";
import type { DiscoverProjectsOptions } from "../src/utils/discover-projects.js";
import { DiscoverStrategy } from "../src/utils/discover-strategy.js";
import type { MemfsWorkspace } from "./utils/memfs-workspace.js";
import { makeMemfsWorkspace } from "./utils/memfs-workspace.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

// A workspace root with pnpm-workspace.yaml and no packages of its own.
const ROOT_FILES = {
	"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
};

/** Seed entries for a workspace package, optionally with a unit test file. */
const pkgFiles = (name: string, opts: { hasUnit?: boolean } = {}): Record<string, string> => ({
	[`packages/${name}/package.json`]: JSON.stringify({ name: `@builder-test/${name}`, version: "0.0.0" }),
	...(opts.hasUnit ? { [`packages/${name}/src/index.test.ts`]: "" } : {}),
});

/**
 * Seed entries for a stand-alone directory (no package.json) that sits NEXT
 * TO the workspace root rather than inside it, as the tmpdir-based original
 * did. Used for `.addProject()` entries that are not workspace packages.
 */
const siblingDir = (dir: string, opts: { hasUnit?: boolean } = {}): Record<string, MemoryFileSystemSeedEntry> =>
	opts.hasUnit ? { [`../${dir}/__test__/index.test.ts`]: "" } : { [`../${dir}`]: MemoryFileSystem.directory() };

/** A pnpm workspace root holding `extra` seed entries. */
const workspace = (extra: Record<string, MemoryFileSystemSeedEntry> = {}): MemfsWorkspace =>
	makeMemfsWorkspace({ ...ROOT_FILES, ...extra });

/** A builder over the workspace's virtual volume, `cwd` at its root. */
const builderFor = (ws: MemfsWorkspace, options: Omit<DiscoverProjectsOptions, "fs" | "syncOps"> = {}) =>
	makeDiscoverBuilder({ cwd: ws.root, ...options, fs: ws.fs, syncOps: ws.syncOps });

/** Absolute path of a sibling directory seeded by {@link siblingDir}. */
const siblingPath = (ws: MemfsWorkspace, dir: string): string => join(ws.root, "..", dir);

const names = (result: Awaited<DiscoverBuilder>) => result.projects?.map((p) => p.test?.name) ?? [];

// A strategy that builds a config for every package and every added entry.
const alwaysConfig = DiscoverStrategy.create({
	tags: [],
	classify: () => [],
	buildProject: async (input) => ({
		extends: true as const,
		test: { name: input.name, environment: "node" as const, include: [] },
	}),
});

// A strategy that declines everything — "no tests".
const emptyStrategy = DiscoverStrategy.create({
	tags: [],
	classify: () => [],
	buildProject: async () => null,
});

describe("DiscoverBuilder (virtual volume)", () => {
	// ── Test 2: immutability ───────────────────────────────────────────────────
	it("should return a new builder from .addProject(), leaving original unchanged", async () => {
		// Given: a workspace with one package, plus a stand-alone test directory
		const ws = workspace({
			...pkgFiles("alpha", { hasUnit: true }),
			...siblingDir("extra-dir", { hasUnit: true }),
		});

		const builder = builderFor(ws, { strategy: alwaysConfig });
		const builderWithAdd = builder.addProject({ name: "extra", path: siblingPath(ws, "extra-dir") });

		// When: resolving the original builder vs the extended one
		const originalResult = await builder;
		const extendedResult = await builderWithAdd;

		// Then: original has only the workspace packages (the root manifest is
		// itself a workspace package, and alwaysConfig accepts it)
		expect(names(originalResult)).toEqual(["root", "@builder-test/alpha"]);

		// And: extended has the same packages plus the added entry
		expect(names(extendedResult)).toEqual(["root", "@builder-test/alpha", "extra"]);

		// And: the two builders are distinct objects
		expect(builder).not.toBe(builderWithAdd);
	});

	// ── Test 3: chained adds ───────────────────────────────────────────────────
	it("should include both entries when .addProject() is chained twice", async () => {
		// Given: two directories with test files
		const ws = workspace({
			...siblingDir("dir-a", { hasUnit: true }),
			...siblingDir("dir-b", { hasUnit: true }),
		});

		// When: chaining two addProject calls
		const result = await builderFor(ws, { strategy: alwaysConfig })
			.addProject({ name: "alpha", path: siblingPath(ws, "dir-a") })
			.addProject({ name: "beta", path: siblingPath(ws, "dir-b") });

		// Then: both entries appear after the workspace root package, in chain order
		expect(names(result)).toEqual(["root", "alpha", "beta"]);
	});

	// ── Test 4: null result throws ─────────────────────────────────────────────
	it("should throw when added entry has no test files under the active strategy", async () => {
		// Given: a directory with NO test files + a strategy that always declines
		const ws = workspace(siblingDir("empty-dir"));
		const emptyDir = siblingPath(ws, "empty-dir");

		// When: resolving a builder with an added entry that produces null
		await expect(
			builderFor(ws, { strategy: emptyStrategy }).addProject({ name: "no-tests", path: emptyDir }),
		).rejects.toThrow(/no-tests|emptyDir/i);

		// And: the error message names the strategy
		await expect(
			builderFor(ws, { strategy: emptyStrategy }).addProject({ name: "no-tests", path: emptyDir }),
		).rejects.toThrow(/ConcreteDiscoverStrategy|DiscoverStrategy|no test files/i);
	});

	// ── Test 5: name conflict throws ───────────────────────────────────────────
	it("should throw when added entry name conflicts with a workspace package", async () => {
		// Given: a workspace with one package named "@builder-test/alpha"
		const ws = workspace({ ...pkgFiles("alpha", { hasUnit: true }), ...siblingDir("dup", { hasUnit: true }) });

		// When: adding a project with the same name as a workspace package
		await expect(
			builderFor(ws, { strategy: alwaysConfig }).addProject({
				name: "@builder-test/alpha",
				path: siblingPath(ws, "dup"),
			}),
		).rejects.toThrow(/@builder-test\/alpha|conflict/i);
	});

	// ── Test 6: path conflict throws ───────────────────────────────────────────
	it("should throw when added entry resolved path conflicts with a workspace package path", async () => {
		// Given: a workspace with one package
		const ws = workspace(pkgFiles("gamma", { hasUnit: true }));

		// When: adding a project pointing at the same absolute path as an existing package
		await expect(
			builderFor(ws, { strategy: alwaysConfig }).addProject({
				name: "different-name",
				path: join(ws.root, "packages", "gamma"),
			}),
		).rejects.toThrow(/conflict|gamma|different-name/i);
	});

	// ── Test 7: empty workspace, no addProject ─────────────────────────────────
	it("should resolve to projects: undefined for empty workspace with no addProject", async () => {
		// Given: a workspace whose only package has NO test files
		const ws = workspace({
			"packages/empty-pkg/package.json": JSON.stringify({ name: "@builder-test/empty-pkg" }),
			"packages/empty-pkg/src/index.ts": "export const x = 1;",
		});

		// When: discovering with a strategy that declines it
		const result = await builderFor(ws, { strategy: emptyStrategy });

		// Then: projects is undefined
		expect(result.projects).toBeUndefined();
		// Tags still returned (empty in this case)
		expect(Array.isArray(result.tags)).toBe(true);
	});

	// ── Test 8: empty workspace + one addProject with custom strategy ──────────
	it("should resolve one project when empty workspace has one addProject with custom strategy", async () => {
		// Given: a custom strategy that always returns the same config
		const oneConfig = {
			extends: true as const,
			test: { name: "test-only", environment: "node" as const, include: [] },
		};
		const customStrategy = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (_input) => oneConfig,
		});
		const ws = workspace(siblingDir("test-only-dir", { hasUnit: true }));

		// When: empty workspace + one addProject
		const result = await builderFor(ws, { strategy: customStrategy }).addProject({
			name: "test-only",
			path: siblingPath(ws, "test-only-dir"),
		});

		// Then: projects contains the config. customStrategy answers every input
		// with it, so the root manifest's package yields a copy as well — the
		// added entry is the last one.
		expect(result.projects).toBeDefined();
		expect(names(result)).toContain("test-only");
		expect(result.projects?.at(-1)).toBe(oneConfig);
	});
});

describe("AgentPlugin.discover() public wiring", () => {
	// ── Test 1: thenable (no-arg form, live repo) ──────────────────────────────
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

	// ── bare-strategy form (live repo) ─────────────────────────────────────────
	it("should forward a bare DiscoverStrategy argument and chain .addProject()", async () => {
		// Given: a strategy that builds a config for every package, passed bare.
		// `./lib` holds no test files, so the default strategy would reject the
		// add — a config for it proves the bare strategy was forwarded.
		// When: discovering the live repo with the bare strategy plus an add
		const result = await AgentPlugin.discover(alwaysConfig).addProject({ name: "wiring-extra", path: "./lib" });

		// Then: the strategy drove the scan over real workspace packages, and
		// the added entry came through
		expect(names(result)).toContain("@vitest-agent/plugin");
		expect(names(result)).toContain("wiring-extra");
	});

	// ── options-object form: cwd + maxDepth (real disk) ────────────────────────
	it("should forward cwd and maxDepth from options-object discover() calls", async () => {
		// Given: a real temp workspace whose pattern can match nested package paths.
		const root = await mkdtemp(join(tmpdir(), "vitest-agent-builder-"));
		try {
			await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/**'\n");
			await writeFile(join(root, "package.json"), ROOT_FILES["package.json"]);
			const shallow = join(root, "packages", "shallow");
			await mkdir(join(shallow, "src"), { recursive: true });
			await writeFile(join(shallow, "package.json"), JSON.stringify({ name: "@builder-test/shallow" }));
			await writeFile(join(shallow, "src", "index.test.ts"), "");
			const segments = Array.from({ length: 34 }, (_, i) => `level-${i}`);
			const deep = join(root, "packages", ...segments, "deep");
			await mkdir(join(deep, "src"), { recursive: true });
			await writeFile(join(deep, "package.json"), JSON.stringify({ name: "@builder-test/deep" }));
			await writeFile(join(deep, "src", "deep.test.ts"), "");

			// Default path: deep package is beyond workspaces' default maxDepth (32).
			const defaultNames = names(await AgentPlugin.discover({ cwd: root }));
			expect(defaultNames).toContain("@builder-test/shallow");
			expect(defaultNames).not.toContain("@builder-test/deep");

			// With explicit maxDepth override, the deep package is discovered.
			const deepNames = names(await AgentPlugin.discover({ cwd: root, maxDepth: 64 }));
			expect(deepNames).toContain("@builder-test/shallow");
			expect(deepNames).toContain("@builder-test/deep");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
