import { join, sep } from "node:path";
import type { TestTagDefinition } from "@vitest/runner";
import { NON_DISCOVERABLE_DIRS, SRC_DIR, TEST_DIR, TEST_FILE_GLOB_SUFFIX, TEST_HELPER_DIRS } from "@vitest-agent/sdk";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { configDefaults } from "vitest/config";
import { findTestFiles } from "./find-test-files.js";
import { Tag } from "./tag.js";
import type { WalkerFileSystem } from "./walker-fs.js";
import { nodeWalkerFs } from "./walker-fs.js";

// ── Shared types ──────────────────────────────────────────────────────────────

/**
 * Resolved metadata about a discovered test module.
 * @public
 */
export interface ModuleInfo {
	/** Absolute path to the module file. */
	readonly path: string;
	/** Path relative to the workspace root, using forward slashes. */
	readonly relativePath: string;
	/** Basename of the file (e.g. `"foo.test.ts"`). */
	readonly filename: string;
	/** The `name` field from the nearest `package.json`. */
	readonly packageName: string;
	/** Absolute path to the package directory. */
	readonly packagePath: string;
}

/**
 * Parsed `package.json` fields that strategies may inspect.
 * @public
 */
export interface PackageJson {
	readonly name?: string;
	readonly version?: string;
	readonly private?: boolean;
	readonly [key: string]: unknown;
}

/**
 * Input passed to `DiscoverStrategy.buildProject` for each workspace package.
 * @public
 */
export interface DiscoverInput {
	/** Package name from `package.json`. */
	readonly name: string;
	/** Absolute path to the package directory. */
	readonly path: string;
	/** Path relative to the workspace root, using forward slashes. */
	readonly relativePath: string;
	/** Absolute path to the workspace root. */
	readonly workspaceRoot: string;
	/** Parsed `package.json` contents, when available. */
	readonly packageJson?: PackageJson;
	/**
	 * Filesystem port the walkers read through. Defaults to `node:fs` when
	 * omitted, which is what every production call site does; tests inject a
	 * virtual volume instead of building a real temporary directory.
	 */
	readonly fs?: WalkerFileSystem;
}

/**
 * Context object passed to a `ClassifyFn`.
 * @public
 */
export interface ClassifyContext {
	/** Metadata for the module being classified. */
	readonly module: ModuleInfo;
	/** All tags registered on the active strategy. */
	readonly tags: ReadonlyArray<Tag>;
	/** Tag names returned by the previous classifier layer (empty for the base layer). */
	readonly inherited: ReadonlyArray<string>;
}

/**
 * A function that maps a module to an array of tag names.
 * @public
 */
export type ClassifyFn = (ctx: ClassifyContext) => ReadonlyArray<string>;

/**
 * Options for `DiscoverStrategy.create`.
 * @public
 */
export interface DiscoverStrategyCreateOptions {
	/** Tags to register on the strategy. */
	readonly tags: ReadonlyArray<Tag>;
	/** Function that produces a Vitest project config for a package, or `null` to skip it. */
	readonly buildProject: (input: DiscoverInput) => Promise<TestProjectInlineConfiguration | null>;
	/** Function that maps a module to tag names. */
	readonly classify: ClassifyFn;
}

/**
 * Options for `DiscoverStrategy.extend`.
 * @public
 */
export interface DiscoverStrategyExtendOptions {
	/** Extra tags to append to the strategy's tag list. */
	readonly additionalTags?: ReadonlyArray<Tag>;
	/** Override or supplement the project-building logic. Receives the inherited result as a second argument. */
	readonly buildProject?: (
		input: DiscoverInput,
		inherited: TestProjectInlineConfiguration | null,
	) => Promise<TestProjectInlineConfiguration | null>;
	/** Override or supplement the classification logic. */
	readonly classify?: ClassifyFn;
}

// ── Private helpers ───────────────────────────────────────────────────────────

const SETUP_EXTS = ["ts", "tsx", "js", "jsx"] as const;

async function detectSetupFile(pkgPath: string, fs: WalkerFileSystem): Promise<string | null> {
	for (const ext of SETUP_EXTS) {
		const candidate = join(pkgPath, `vitest.setup.${ext}`);
		if ((await fs.statEntry(candidate))?.isFile === true) return `vitest.setup.${ext}`;
	}
	return null;
}

// ── Abstract base class ────────────────────────────────────────────────────────

/**
 * Abstract base for workspace discovery strategies. Implement `buildProject` and
 * `classify` to control which packages become Vitest projects and how their test
 * files are tagged. Use `DiscoverStrategy.create` to build a concrete instance
 * from plain functions, or extend `DefaultDiscoverStrategy` to layer on top of
 * the built-in unit/int/e2e heuristics.
 * @public
 */
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

/**
 * The built-in `DiscoverStrategy` used by `AgentPlugin.discover` when no custom
 * strategy is supplied. Registers `unit`, `int` (60 s timeout), and `e2e`
 * (120 s timeout, retry in CI) tags and classifies test files by filename suffix
 * (`.int.test.*` → `"int"`, `.e2e.test.*` → `"e2e"`, everything else → `"unit"`).
 * @public
 */
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
		const fs = input.fs ?? nodeWalkerFs;
		const srcPrefix = join(input.path, SRC_DIR);
		const allFiles = await findTestFiles(
			input.path,
			[`${SRC_DIR}/**/${TEST_FILE_GLOB_SUFFIX}`, `${TEST_DIR}/**/${TEST_FILE_GLOB_SUFFIX}`],
			fs,
		);
		if (allFiles.length === 0) return null;
		const hasSrcTests = allFiles.some((f) => f.startsWith(`${srcPrefix}${sep}`) || f === srcPrefix);
		const hasTestDirTests = allFiles.some((f) => !(f.startsWith(`${srcPrefix}${sep}`) || f === srcPrefix));

		// Include globs are absolute and ANCHORED at the package root. An
		// unanchored `**/__test__/**` escapes the package: Vitest globs the
		// pattern literally with no nested-package.json concept, and for the root
		// workspace — which @effected/workspaces reports at the repo root — that
		// means globbing the whole repo, collecting every sub-package's suite
		// against the wrong toolchain (issue #227).
		const include: string[] = [];
		if (hasSrcTests) {
			include.push(join(input.path, SRC_DIR, "**", TEST_FILE_GLOB_SUFFIX));
		}
		if (hasTestDirTests) {
			include.push(join(input.path, TEST_DIR, "**", TEST_FILE_GLOB_SUFFIX));
		}

		// A custom `test.exclude` REPLACES Vitest's defaults rather than merging,
		// so `configDefaults.exclude` must be re-stated or we lose
		// `**/node_modules/**` and `**/.git/**`.
		//
		// The `NON_DISCOVERABLE_DIRS` globs close the last divergence between the
		// walker and the emitted glob. `findTestFiles` prunes those directories, so
		// build output can never be the *reason* a project is emitted — but once a
		// project exists for other tests, `<path>/src/**` would still match a test
		// nested inside one, and Vitest's defaults cover only `node_modules` and
		// `.git`. Bounding each under both include roots keeps the two views of
		// "what is a test file" agreeing.
		//
		// The helper-dir globs are bounded under `__test__/`, where the `**` cannot
		// escape the project, and cover both the flat layout and the kind-nested
		// one (`__test__/integration/`).
		const exclude: string[] = [
			...configDefaults.exclude,
			...[SRC_DIR, TEST_DIR].flatMap((root) =>
				[...NON_DISCOVERABLE_DIRS].map((d) => join(input.path, root, "**", d, "**")),
			),
			...(hasTestDirTests ? TEST_HELPER_DIRS.map((d) => join(input.path, TEST_DIR, d, "**")) : []),
		];

		// Detect setup file
		const setupFile = await detectSetupFile(input.path, fs);

		return {
			extends: true,
			test: {
				name: input.name,
				environment: "node",
				include,
				exclude,
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
