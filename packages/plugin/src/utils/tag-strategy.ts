import type { TestTagDefinition } from "@vitest/runner";
import { Tag } from "./tag.js";

export interface ModuleInfo {
	readonly path: string;
	readonly relativePath: string;
	readonly filename: string;
	readonly packageName: string;
	readonly packagePath: string;
}

export interface ClassifyBaseContext {
	readonly module: ModuleInfo;
	readonly tags: ReadonlyArray<Tag>;
}

export interface ClassifyExtendedContext extends ClassifyBaseContext {
	readonly inherited: ReadonlyArray<string>;
}

export type ClassifyBaseFn = (ctx: ClassifyBaseContext) => ReadonlyArray<string>;
export type ClassifyExtendedFn = (ctx: ClassifyExtendedContext) => ReadonlyArray<string>;

export interface TagStrategyCreateOptions {
	readonly tags: ReadonlyArray<Tag>;
	readonly classify: ClassifyBaseFn;
}

export interface TagStrategyExtendOptions {
	readonly additionalTags?: ReadonlyArray<Tag>;
	readonly classify?: ClassifyExtendedFn;
}

const DEFAULT_TAGS: ReadonlyArray<Tag> = [
	Tag.make("unit"),
	Tag.make("int", { timeout: 60_000 }),
	Tag.make("e2e", {
		timeout: 120_000,
		retry: process.env.CI ? 2 : 0,
	}),
];

const defaultClassify: ClassifyBaseFn = ({ module }) => {
	if (/\.e2e\.(test|spec)\.(ts|tsx|js|jsx)$/.test(module.filename)) return ["e2e"];
	if (/\.int\.(test|spec)\.(ts|tsx|js|jsx)$/.test(module.filename)) return ["int"];
	return ["unit"];
};

export class TagStrategy {
	readonly tags: ReadonlyArray<Tag>;
	readonly #layers: ReadonlyArray<ClassifyBaseFn | ClassifyExtendedFn>;

	private constructor(tags: ReadonlyArray<Tag>, layers: ReadonlyArray<ClassifyBaseFn | ClassifyExtendedFn>) {
		this.tags = tags;
		this.#layers = layers;
	}

	get tagDefinitions(): ReadonlyArray<TestTagDefinition> {
		return this.tags.map((t) => t.definition);
	}

	classify(ctx: { module: ModuleInfo }): ReadonlyArray<string> {
		const baseLayer = this.#layers[0] as ClassifyBaseFn;
		let inherited = baseLayer({ module: ctx.module, tags: this.tags });
		for (let i = 1; i < this.#layers.length; i++) {
			const layer = this.#layers[i] as ClassifyExtendedFn;
			inherited = layer({ module: ctx.module, tags: this.tags, inherited });
		}
		return inherited;
	}

	static create(options: TagStrategyCreateOptions): TagStrategy {
		return new TagStrategy(options.tags, [options.classify]);
	}

	extend(options: TagStrategyExtendOptions): TagStrategy {
		const tags = [...this.tags, ...(options.additionalTags ?? [])];
		const layers: Array<ClassifyBaseFn | ClassifyExtendedFn> = [...this.#layers];
		const passthrough: ClassifyExtendedFn = (ctx) => ctx.inherited;
		layers.push(options.classify ?? passthrough);
		return new TagStrategy(tags, layers);
	}

	static readonly default: TagStrategy = TagStrategy.create({
		tags: DEFAULT_TAGS,
		classify: defaultClassify,
	});
}
