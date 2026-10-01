import { join } from "node:path";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifyContext, DiscoverInput, ModuleInfo } from "../src/utils/discover-strategy.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import { Tag } from "../src/utils/tag.js";
import { seedMemfsWalker } from "./utils/memfs-walker.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Package trees are seeded into an `@effected/memfs` volume and handed to the
// strategy through `DiscoverInput.fs` — nothing touches disk.
// `buildProject` keeps no cache, so a fixed package path is safe to share.

const PKG = "/ws/packages/test-pkg";

function makeModuleInfo(filename: string): ModuleInfo {
	return {
		path: `/pkg/src/${filename}`,
		relativePath: `src/${filename}`,
		filename,
		packageName: "@test/pkg",
		packagePath: "/pkg",
	};
}

function makeDiscoverInput(overrides?: Partial<DiscoverInput>): DiscoverInput {
	return {
		name: "test-pkg",
		path: PKG,
		relativePath: "packages/test-pkg",
		workspaceRoot: "/ws",
		...overrides,
	};
}

/**
 * A {@link DiscoverInput} whose `fs` is a volume seeded with `files` (paths
 * relative to the package root).
 */
async function seededInput(
	files: Readonly<Record<string, MemoryFileSystemSeedEntry>>,
	overrides?: Partial<DiscoverInput>,
): Promise<DiscoverInput> {
	return makeDiscoverInput({ fs: seedMemfsWalker(PKG, files), ...overrides });
}

// ── Goal 13: DiscoverStrategy abstract class ──────────────────────────────────

describe("DiscoverStrategy.create()", () => {
	it("should round-trip classify and buildProject through DiscoverStrategy.create()", async () => {
		// Given: a custom tag, classify fn, and buildProject fn
		const customTag = Tag.make("custom");
		const customClassify = ({ module }: ClassifyContext) => {
			if (module.filename.endsWith(".custom.test.ts")) return ["custom"];
			return ["unit"];
		};
		const customBuildProject = async (_input: DiscoverInput) =>
			({ extends: true, test: { name: "custom", environment: "node" as const } }) as const;

		// When: creating a strategy from those options
		const strategy = DiscoverStrategy.create({
			tags: [customTag],
			classify: customClassify,
			buildProject: customBuildProject,
		});

		// Then: the classify and buildProject round-trip correctly
		expect(strategy.tags).toHaveLength(1);
		expect(strategy.tags[0].name).toBe("custom");

		const classifyResult = strategy.classify({ module: makeModuleInfo("foo.custom.test.ts") });
		expect(classifyResult).toEqual(["custom"]);

		const fallbackResult = strategy.classify({ module: makeModuleInfo("foo.test.ts") });
		expect(fallbackResult).toEqual(["unit"]);

		const projectResult = await strategy.buildProject(makeDiscoverInput());
		expect(projectResult).not.toBeNull();
		expect(projectResult?.test?.name).toBe("custom");
		expect(projectResult?.test?.environment).toBe("node");
	});
});

describe("DiscoverStrategy.create().extend()", () => {
	it("should chain classifiers and append tags via .extend()", async () => {
		// Given: a base strategy and extension with additional tags
		const baseTag = Tag.make("base");
		const extTag = Tag.make("ext");

		const baseClassify = (_ctx: ClassifyContext) => ["base"];
		const extClassify = (ctx: ClassifyContext) => {
			// extended classify sees inherited from the base
			return [...ctx.inherited, "ext"];
		};

		const base = DiscoverStrategy.create({
			tags: [baseTag],
			classify: baseClassify,
			buildProject: async () => null,
		});

		// When: extending with additional tags and a chained classifier
		const extended = base.extend({
			additionalTags: [extTag],
			classify: extClassify,
		});

		// Then: tags are appended, and extended classify sees inherited result
		expect(extended.tags).toHaveLength(2);
		expect(extended.tags.map((t) => t.name)).toEqual(["base", "ext"]);

		const result = extended.classify({ module: makeModuleInfo("foo.test.ts") });
		expect(result).toEqual(["base", "ext"]);
	});

	it("should chain buildProject via .extend() passing inherited config", async () => {
		// Given: a base strategy returning a base config
		const baseConfig = { extends: true as const, test: { name: "base-pkg", environment: "node" as const } };
		const base = DiscoverStrategy.create({
			tags: [Tag.make("unit")],
			classify: () => ["unit"],
			buildProject: async () => baseConfig,
		});

		// When: extending with a buildProject that receives the inherited config
		let receivedInherited: typeof baseConfig | null = null;
		const extended = base.extend({
			buildProject: async (_input, inherited) => {
				receivedInherited = inherited as typeof baseConfig | null;
				if (!inherited) return null;
				return { ...inherited, test: { ...inherited.test, environment: "jsdom" as const } };
			},
		});

		// Then: the extended buildProject receives the inherited config and can merge
		const result = await extended.buildProject(makeDiscoverInput());
		expect(receivedInherited).toEqual(baseConfig);
		expect(result?.test?.environment).toBe("jsdom");
	});

	it("should return happy-dom environment config from custom buildProject via .create()", async () => {
		// Given: a custom strategy with a buildProject returning happy-dom environment
		const strategy = DiscoverStrategy.create({
			tags: [Tag.make("unit")],
			classify: () => ["unit"],
			buildProject: async (input) => ({
				extends: true as const,
				test: {
					name: input.name,
					environment: "happy-dom" as const,
				},
			}),
		});

		// When: calling buildProject
		const result = await strategy.buildProject(makeDiscoverInput({ name: "my-pkg" }));

		// Then: the returned config has happy-dom environment
		expect(result).not.toBeNull();
		expect(result?.test?.name).toBe("my-pkg");
		expect(result?.test?.environment).toBe("happy-dom");
	});
});

// ── Goal 14: DefaultDiscoverStrategy ─────────────────────────────────────────

describe("DefaultDiscoverStrategy classify()", () => {
	it('should classify .e2e.test.ts to ["e2e"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.e2e.test.ts") });
		expect(result).toEqual(["e2e"]);
	});

	it('should classify .e2e.spec.ts to ["e2e"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.e2e.spec.ts") });
		expect(result).toEqual(["e2e"]);
	});

	it('should classify .int.test.ts to ["int"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.int.test.ts") });
		expect(result).toEqual(["int"]);
	});

	it('should classify .int.spec.tsx to ["int"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.int.spec.tsx") });
		expect(result).toEqual(["int"]);
	});

	it('should classify plain .test.ts to ["unit"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.test.ts") });
		expect(result).toEqual(["unit"]);
	});

	it('should classify .spec.js to ["unit"]', () => {
		const strategy = new DefaultDiscoverStrategy();
		const result = strategy.classify({ module: makeModuleInfo("foo.spec.js") });
		expect(result).toEqual(["unit"]);
	});
});

describe("DefaultDiscoverStrategy.buildProject()", () => {
	it("should return null when no test files exist", async () => {
		// Given: a directory with no test files
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject on an empty dir
		const result = await strategy.buildProject(await seededInput({ "": MemoryFileSystem.directory() }));

		// Then: returns null
		expect(result).toBeNull();
	});

	it("should return config with src glob only, and still exclude non-discoverable dirs, for a src-only package", async () => {
		// Given: a package with only src/foo.test.ts
		const input = await seededInput({ "src/foo.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(input);

		// Then: include covers src/ only
		expect(result).not.toBeNull();
		expect(result?.extends).toBe(true);
		expect(result?.test?.environment).toBe("node");
		const include = result?.test?.include as string[];
		expect(include.some((p) => p.includes("src/"))).toBe(true);
		expect(include.every((p) => !p.includes("__test__/"))).toBe(true);

		// And: an exclude is still emitted. The walker prunes NON_DISCOVERABLE_DIRS,
		// so build output can never be why this project exists — but the include
		// glob would otherwise match a test nested inside one, and Vitest's own
		// defaults cover only node_modules and .git.
		const exclude = result?.test?.exclude as string[] | undefined;
		expect(exclude).toBeDefined();
		expect(exclude?.some((p) => p === join(PKG, "src", "**", "dist", "**"))).toBe(true);
		expect(exclude?.some((p) => p.includes("node_modules"))).toBe(true);
	});

	it("should bound every non-discoverable dir under both include roots (PR 228 review)", async () => {
		// Given: a package with tests under both roots
		const input = await seededInput({ "src/foo.test.ts": "", "__test__/bar.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(input);

		// Then: each non-discoverable dir is bounded under BOTH roots by exact path,
		// so the emitted glob agrees with what findTestFiles would have walked
		const exclude = (result?.test?.exclude ?? []) as string[];
		for (const root of ["src", "__test__"]) {
			for (const dir of ["node_modules", ".git", "dist"]) {
				expect(exclude).toContain(join(PKG, root, "**", dir, "**"));
			}
		}
	});

	it("should return config with __test__ glob and exclude helper subdirs for __test__-only package", async () => {
		// Given: a package with only __test__/foo.test.ts
		const input = await seededInput({ "__test__/foo.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(input);

		// Then: include covers __test__/, exclude lists three helper subdirs
		expect(result).not.toBeNull();
		const include = result?.test?.include as string[];
		expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		expect(include.every((p) => !p.includes("src/"))).toBe(true);
		const exclude = result?.test?.exclude as string[] | undefined;
		expect(exclude).toBeDefined();
		// The helper-dir excludes are anchored directly under __test__/ — the
		// helper dir must be the segment right at the test root, not "**" away
		// from it — so a same-named suite directory nested deeper (e.g.
		// __test__/unit/utils/, the mirror of src/utils/) is not excluded
		// (issue #251).
		expect(exclude?.some((p) => p === join(PKG, "__test__", "utils", "**"))).toBe(true);
		expect(exclude?.some((p) => p === join(PKG, "__test__", "fixtures", "**"))).toBe(true);
		expect(exclude?.some((p) => p === join(PKG, "__test__", "snapshots", "**"))).toBe(true);
		// A custom `test.exclude` REPLACES Vitest's defaults rather than merging,
		// so it must re-state `**/node_modules/**` and `**/.git/**` — otherwise
		// the broad `__test__/**` include glob re-walks into nested
		// `__test__/.../node_modules/**` and runs dependencies' own test files.
		expect(exclude?.some((p) => p.includes("node_modules"))).toBe(true);
		expect(exclude?.some((p) => p.includes(".git"))).toBe(true);
	});

	it("does not emit the any-depth helper-dir exclude glob for any TEST_HELPER_DIRS entry (regression guard, issue #251)", async () => {
		// Given: a package with only __test__/foo.test.ts
		const input = await seededInput({ "__test__/foo.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(input);

		// Then: none of the helper-dir excludes use the old any-depth "**" form
		// that matched the helper dir name at ANY depth under __test__/, sweeping
		// a legitimate __test__/unit/utils/ suite out of discovery silently.
		// Positive control: the project exists, so the loop below is not vacuous.
		expect(result).not.toBeNull();
		const exclude = (result?.test?.exclude ?? []) as string[];
		for (const dir of ["fixtures", "snapshots", "utils"]) {
			expect(exclude).not.toContain(join(PKG, "__test__", "**", dir, "**"));
		}
	});

	it("should return config covering both src and __test__ globs for hybrid package", async () => {
		// Given: a package with both src/foo.test.ts and __test__/bar.test.ts
		const input = await seededInput({ "src/foo.test.ts": "", "__test__/bar.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(input);

		// Then: both globs are present
		expect(result).not.toBeNull();
		const include = result?.test?.include as string[];
		expect(include.some((p) => p.includes("src/"))).toBe(true);
		expect(include.some((p) => p.includes("__test__/"))).toBe(true);
	});

	describe("setup file detection", () => {
		for (const ext of ["ts", "tsx", "js", "jsx"]) {
			it(`should detect vitest.setup.${ext} and thread into setupFiles`, async () => {
				// Given: a package with a test file and a setup file
				const input = await seededInput({ "src/foo.test.ts": "", [`vitest.setup.${ext}`]: "" });
				const strategy = new DefaultDiscoverStrategy();

				// When: calling buildProject
				const result = await strategy.buildProject(input);

				// Then: setupFiles contains an absolute path ending with the setup filename
				expect(result).not.toBeNull();
				const setupFiles = result?.test?.setupFiles as string[] | undefined;
				expect(setupFiles).toBeDefined();
				expect(setupFiles?.some((f) => f.endsWith(`vitest.setup.${ext}`))).toBe(true);
			});
		}
	});

	it("does not discover tests in nested non-src __test__ directories (issue #227)", async () => {
		// Given: a package whose only tests live under lib/scripts/__test__/
		// — not src/, not the package-root __test__/. That is an invalid location.
		// (The shape of the checked-in `fixtures/nested-test-dir-project`.)
		const input = await seededInput(
			{
				"package.json": JSON.stringify({ name: "nested-test-dir-project", private: true, type: "module" }),
				"lib/scripts/__test__/sample.test.ts": "",
			},
			{ name: "nested-test-dir-project" },
		);
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject against that package
		const project = await strategy.buildProject(input);

		// Then: nothing is discoverable, so the package is skipped entirely
		expect(project).toBeNull();
	});

	it("emits only anchored include globs (issue #227)", async () => {
		// Given: a package with both a src/ test and a root __test__/ test
		const input = await seededInput({ "src/foo.test.ts": "", "__test__/bar.test.ts": "" });
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const project = await strategy.buildProject(input);

		// Then: no include glob is unanchored — an unanchored glob escapes the
		// package and, for the root workspace, globs the entire repo
		const include = (project?.test?.include ?? []) as string[];
		expect(include.length).toBeGreaterThan(0);
		expect(include.every((g) => !g.includes("**/__test__"))).toBe(true);
		expect(include.some((g) => g === join(PKG, "src", "**", "*.{test,spec}.{ts,tsx,js,jsx}"))).toBe(true);
		expect(include.some((g) => g === join(PKG, "__test__", "**", "*.{test,spec}.{ts,tsx,js,jsx}"))).toBe(true);
	});
});

describe("DefaultDiscoverStrategy e2e retry (RuntimeEnv CI rule)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const e2eRetry = (): number | undefined =>
		new DefaultDiscoverStrategy().tagDefinitions.find((t) => t.name === "e2e")?.retry as number | undefined;

	it.each([
		{ label: "CI=true", env: { CI: "true", GITHUB_ACTIONS: "" }, retry: 2 },
		{ label: "CI=1", env: { CI: "1", GITHUB_ACTIONS: "" }, retry: 2 },
		{
			label: "CONTINUOUS_INTEGRATION=yes",
			env: { CI: "", CONTINUOUS_INTEGRATION: "yes", GITHUB_ACTIONS: "" },
			retry: 2,
		},
		{ label: "GITHUB_ACTIONS=true beats CI=false", env: { CI: "false", GITHUB_ACTIONS: "true" }, retry: 2 },
		{ label: "CI=false (truthy string, not CI)", env: { CI: "false", GITHUB_ACTIONS: "" }, retry: 0 },
		{ label: "CI=0", env: { CI: "0", GITHUB_ACTIONS: "" }, retry: 0 },
		{ label: "CI empty", env: { CI: "", CONTINUOUS_INTEGRATION: "", GITHUB_ACTIONS: "" }, retry: 0 },
	])("$label -> retry $retry", ({ env, retry }) => {
		for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
		expect(e2eRetry()).toBe(retry);
	});

	it("reads the environment when the strategy is constructed, not at module load", () => {
		vi.stubEnv("GITHUB_ACTIONS", "");
		vi.stubEnv("CONTINUOUS_INTEGRATION", "");
		vi.stubEnv("CI", "");
		expect(e2eRetry()).toBe(0);
		vi.stubEnv("CI", "true");
		expect(e2eRetry()).toBe(2);
	});
});
