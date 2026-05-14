import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { TestTagDefinition } from "@vitest/runner";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { findTestFiles } from "./find-test-files.js";
import { Tag } from "./tag.js";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ModuleInfo {
	readonly path: string;
	readonly relativePath: string;
	readonly filename: string;
	readonly packageName: string;
	readonly packagePath: string;
}

/** Parsed package.json fields that strategies may inspect. */
export interface PackageJson {
	readonly name?: string;
	readonly version?: string;
	readonly private?: boolean;
	readonly [key: string]: unknown;
}

export interface DiscoverInput {
	readonly name: string;
	readonly path: string;
	readonly relativePath: string;
	readonly workspaceRoot: string;
	readonly packageJson?: PackageJson;
}

export interface ClassifyContext {
	readonly module: ModuleInfo;
	readonly tags: ReadonlyArray<Tag>;
	readonly inherited: ReadonlyArray<string>;
}

export type ClassifyFn = (ctx: ClassifyContext) => ReadonlyArray<string>;

export interface DiscoverStrategyCreateOptions {
	readonly tags: ReadonlyArray<Tag>;
	readonly buildProject: (input: DiscoverInput) => Promise<TestProjectInlineConfiguration | null>;
	readonly classify: ClassifyFn;
}

export interface DiscoverStrategyExtendOptions {
	readonly additionalTags?: ReadonlyArray<Tag>;
	readonly buildProject?: (
		input: DiscoverInput,
		inherited: TestProjectInlineConfiguration | null,
	) => Promise<TestProjectInlineConfiguration | null>;
	readonly classify?: ClassifyFn;
}

// ── Private helpers ───────────────────────────────────────────────────────────

const SETUP_EXTS = ["ts", "tsx", "js", "jsx"] as const;
const TEST_DIR_HELPER_DIRS = ["utils", "fixtures", "snapshots"] as const;

async function isDir(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

async function isFile(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isFile();
	} catch {
		return false;
	}
}

async function detectSetupFile(pkgPath: string): Promise<string | null> {
	for (const ext of SETUP_EXTS) {
		const candidate = join(pkgPath, `vitest.setup.${ext}`);
		if (await isFile(candidate)) return `vitest.setup.${ext}`;
	}
	return null;
}

// ── Abstract base class ────────────────────────────────────────────────────────

export abstract class DiscoverStrategy {
	abstract readonly tags: ReadonlyArray<Tag>;
	abstract get tagDefinitions(): ReadonlyArray<TestTagDefinition>;
	abstract buildProject(input: DiscoverInput): Promise<TestProjectInlineConfiguration | null>;
	abstract classify(ctx: { module: ModuleInfo }): ReadonlyArray<string>;
	abstract extend(options: DiscoverStrategyExtendOptions): DiscoverStrategy;

	static create(options: DiscoverStrategyCreateOptions): DiscoverStrategy {
		return new ConcreteDiscoverStrategy(options.tags, [options.classify], [options.buildProject]);
	}
}

// ── Concrete inner class produced by DiscoverStrategy.create() ────────────────

type BaseBuildProjectFn = (input: DiscoverInput) => Promise<TestProjectInlineConfiguration | null>;
type ExtendBuildProjectFn = (
	input: DiscoverInput,
	inherited: TestProjectInlineConfiguration | null,
) => Promise<TestProjectInlineConfiguration | null>;

class ConcreteDiscoverStrategy extends DiscoverStrategy {
	readonly tags: ReadonlyArray<Tag>;
	readonly #classifyLayers: ReadonlyArray<ClassifyFn>;
	readonly #buildProjectLayers: ReadonlyArray<BaseBuildProjectFn | ExtendBuildProjectFn>;

	constructor(
		tags: ReadonlyArray<Tag>,
		classifyLayers: ReadonlyArray<ClassifyFn>,
		buildProjectLayers: ReadonlyArray<BaseBuildProjectFn | ExtendBuildProjectFn>,
	) {
		super();
		this.tags = tags;
		this.#classifyLayers = classifyLayers;
		this.#buildProjectLayers = buildProjectLayers;
	}

	get tagDefinitions(): ReadonlyArray<TestTagDefinition> {
		return this.tags.map((t) => t.definition);
	}

	classify(ctx: { module: ModuleInfo }): ReadonlyArray<string> {
		// First layer is the base — receives no `inherited` (empty array placeholder).
		const baseLayer = this.#classifyLayers[0];
		let inherited = baseLayer({ module: ctx.module, tags: this.tags, inherited: [] });
		for (let i = 1; i < this.#classifyLayers.length; i++) {
			const layer = this.#classifyLayers[i];
			inherited = layer({ module: ctx.module, tags: this.tags, inherited });
		}
		return inherited;
	}

	async buildProject(input: DiscoverInput): Promise<TestProjectInlineConfiguration | null> {
		const baseLayer = this.#buildProjectLayers[0] as BaseBuildProjectFn;
		let result = await baseLayer(input);
		for (let i = 1; i < this.#buildProjectLayers.length; i++) {
			const layer = this.#buildProjectLayers[i] as ExtendBuildProjectFn;
			result = await layer(input, result);
		}
		return result;
	}

	extend(options: DiscoverStrategyExtendOptions): DiscoverStrategy {
		const newTags = [...this.tags, ...(options.additionalTags ?? [])];

		const newClassifyLayers: ClassifyFn[] = [...this.#classifyLayers];
		if (options.classify) {
			newClassifyLayers.push(options.classify);
		}

		const newBuildProjectLayers: Array<BaseBuildProjectFn | ExtendBuildProjectFn> = [...this.#buildProjectLayers];
		if (options.buildProject) {
			newBuildProjectLayers.push(options.buildProject);
		}

		return new ConcreteDiscoverStrategy(newTags, newClassifyLayers, newBuildProjectLayers);
	}
}

// ── DefaultDiscoverStrategy ───────────────────────────────────────────────────

const DEFAULT_TAGS: ReadonlyArray<Tag> = [
	Tag.make("unit"),
	Tag.make("int", { timeout: 60_000 }),
	Tag.make("e2e", {
		timeout: 120_000,
		retry: process.env.CI ? 2 : 0,
	}),
];

const E2E_RE = /\.e2e\.(test|spec)\.(ts|tsx|js|jsx)$/;
const INT_RE = /\.int\.(test|spec)\.(ts|tsx|js|jsx)$/;

export class DefaultDiscoverStrategy extends DiscoverStrategy {
	readonly tags: ReadonlyArray<Tag> = DEFAULT_TAGS;

	get tagDefinitions(): ReadonlyArray<TestTagDefinition> {
		return this.tags.map((t) => t.definition);
	}

	classify(ctx: { module: ModuleInfo }): ReadonlyArray<string> {
		if (E2E_RE.test(ctx.module.filename)) return ["e2e"];
		if (INT_RE.test(ctx.module.filename)) return ["int"];
		return ["unit"];
	}

	async buildProject(input: DiscoverInput): Promise<TestProjectInlineConfiguration | null> {
		const testDir = join(input.path, "__test__");
		const hasTestDir = await isDir(testDir);

		// Single filesystem walk that matches against both patterns at once.
		// Two separate findTestFiles calls would traverse the whole package tree
		// twice; bucketing the combined result by path prefix yields the same
		// include-glob shape with one walk.
		const srcPrefix = join(input.path, "src");
		const testPrefix = join(input.path, "__test__");
		const allFiles = await findTestFiles(input.path, [
			"src/**/*.{test,spec}.{ts,tsx,js,jsx}",
			"__test__/**/*.{test,spec}.{ts,tsx,js,jsx}",
		]);
		if (allFiles.length === 0) return null;
		const hasSrcTests = allFiles.some((f) => f.startsWith(`${srcPrefix}${sep}`) || f === srcPrefix);
		const hasTestDirTests = allFiles.some((f) => f.startsWith(`${testPrefix}${sep}`) || f === testPrefix);

		// Build include globs as absolute paths so they resolve correctly regardless
		// of where the root vitest.config.ts lives (monorepo root vs package root).
		const include: string[] = [];
		if (hasSrcTests) {
			include.push(join(input.path, "src/**/*.{test,spec}.{ts,tsx,js,jsx}"));
		}
		if (hasTestDirTests) {
			include.push(join(input.path, "__test__/**/*.{test,spec}.{ts,tsx,js,jsx}"));
		}

		// Exclude helper subdirs inside __test__/ when __test__ is present (absolute paths)
		const exclude: string[] | undefined = hasTestDir
			? TEST_DIR_HELPER_DIRS.map((d) => join(input.path, `__test__/${d}/**`))
			: undefined;

		// Detect setup file
		const setupFile = await detectSetupFile(input.path);

		return {
			extends: true,
			test: {
				name: input.name,
				environment: "node",
				include,
				...(exclude ? { exclude } : {}),
				...(setupFile ? { setupFiles: [join(input.path, setupFile)] } : {}),
			},
		};
	}

	extend(options: DiscoverStrategyExtendOptions): DiscoverStrategy {
		// Delegate to ConcreteDiscoverStrategy's extension machinery
		const base = DiscoverStrategy.create({
			tags: this.tags,
			classify: (ctx) => this.classify(ctx),
			buildProject: (input) => this.buildProject(input),
		});
		return base.extend(options);
	}
}
