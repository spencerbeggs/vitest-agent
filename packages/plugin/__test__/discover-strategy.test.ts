import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClassifyContext, DiscoverInput, ModuleInfo } from "../src/utils/discover-strategy.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import { Tag } from "../src/utils/tag.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "vitest-agent-discover-strategy-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

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
		path: tmpDir,
		relativePath: "packages/test-pkg",
		workspaceRoot: join(tmpDir, ".."),
		...overrides,
	};
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
		const result = await strategy.buildProject(makeDiscoverInput());

		// Then: returns null
		expect(result).toBeNull();
	});

	it("should return config with src glob only and no exclude for src-only package", async () => {
		// Given: a package with only src/foo.test.ts
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(makeDiscoverInput());

		// Then: include covers src/, exclude is absent
		expect(result).not.toBeNull();
		expect(result?.extends).toBe(true);
		expect(result?.test?.environment).toBe("node");
		const include = result?.test?.include as string[];
		expect(include.some((p) => p.includes("src/"))).toBe(true);
		expect(include.every((p) => !p.includes("__test__/"))).toBe(true);
		expect(result?.test?.exclude).toBeUndefined();
	});

	it("should return config with __test__ glob and exclude helper subdirs for __test__-only package", async () => {
		// Given: a package with only __test__/foo.test.ts
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "__test__", "foo.test.ts"), "");
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(makeDiscoverInput());

		// Then: include covers __test__/, exclude lists three helper subdirs
		expect(result).not.toBeNull();
		const include = result?.test?.include as string[];
		expect(include.some((p) => p.includes("__test__/"))).toBe(true);
		expect(include.every((p) => !p.includes("src/"))).toBe(true);
		const exclude = result?.test?.exclude as string[] | undefined;
		expect(exclude).toBeDefined();
		expect(exclude?.some((p) => p.includes("__test__/utils"))).toBe(true);
		expect(exclude?.some((p) => p.includes("__test__/fixtures"))).toBe(true);
		expect(exclude?.some((p) => p.includes("__test__/snapshots"))).toBe(true);
		// A custom `test.exclude` REPLACES Vitest's defaults rather than merging,
		// so it must re-state `**/node_modules/**` and `**/.git/**` — otherwise
		// the broad `__test__/**` include glob re-walks into nested
		// `__test__/.../node_modules/**` and runs dependencies' own test files.
		expect(exclude?.some((p) => p.includes("node_modules"))).toBe(true);
		expect(exclude?.some((p) => p.includes(".git"))).toBe(true);
	});

	it("should return config covering both src and __test__ globs for hybrid package", async () => {
		// Given: a package with both src/foo.test.ts and __test__/bar.test.ts
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await mkdir(join(tmpDir, "__test__"), { recursive: true });
		await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
		await writeFile(join(tmpDir, "__test__", "bar.test.ts"), "");
		const strategy = new DefaultDiscoverStrategy();

		// When: calling buildProject
		const result = await strategy.buildProject(makeDiscoverInput());

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
				await mkdir(join(tmpDir, "src"), { recursive: true });
				await writeFile(join(tmpDir, "src", "foo.test.ts"), "");
				await writeFile(join(tmpDir, `vitest.setup.${ext}`), "");
				const strategy = new DefaultDiscoverStrategy();

				// When: calling buildProject
				const result = await strategy.buildProject(makeDiscoverInput());

				// Then: setupFiles contains an absolute path ending with the setup filename
				expect(result).not.toBeNull();
				const setupFiles = result?.test?.setupFiles as string[] | undefined;
				expect(setupFiles).toBeDefined();
				expect(setupFiles?.some((f) => f.endsWith(`vitest.setup.${ext}`))).toBe(true);
			});
		}
	});
});
