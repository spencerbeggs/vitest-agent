import { cpus } from "node:os";
import type { TestProjectInlineConfiguration } from "vitest/config";

export type VitestProjectKind = "unit" | "e2e" | "int" | (string & {});

export interface VitestProjectOptions {
	name: string;
	include: string[];
	kind?: VitestProjectKind;
	overrides?: Partial<TestProjectInlineConfiguration>;
}

export class VitestProject {
	readonly #name: string;
	readonly #kind: VitestProjectKind;
	#config: TestProjectInlineConfiguration;
	readonly #coverageExcludes: string[] = [];

	private constructor(options: VitestProjectOptions, defaults: Partial<TestProjectInlineConfiguration>) {
		this.#name = options.name;
		this.#kind = options.kind ?? "unit";
		const { test: defaultTest, ...defaultRest } = defaults;
		const { test: overrideTest, ...overrideRest } = options.overrides ?? {};
		this.#config = {
			extends: true as const,
			...defaultRest,
			...overrideRest,
			test: {
				...defaultTest,
				...overrideTest,
				name: options.name,
				include: options.include,
			},
		} as TestProjectInlineConfiguration;
	}

	get name(): string {
		return this.#name;
	}

	get kind(): VitestProjectKind {
		return this.#kind;
	}

	get coverageExcludes(): readonly string[] {
		return this.#coverageExcludes;
	}

	toConfig(): TestProjectInlineConfiguration {
		return this.#config;
	}

	clone(): VitestProject {
		const { test, ...rest } = this.#config;
		const cloned = new VitestProject({ name: this.#name, include: test?.include ?? [], kind: this.#kind }, {});
		cloned.#config = { ...rest, test: test ? { ...test } : undefined } as TestProjectInlineConfiguration;
		cloned.#coverageExcludes.push(...this.#coverageExcludes);
		return cloned;
	}

	override(config: Partial<TestProjectInlineConfiguration>): this {
		const { test: overrideTest, ...overrideRest } = config;
		const { test: existingTest, ...existingRest } = this.#config;
		this.#config = {
			...existingRest,
			...overrideRest,
			test: { ...existingTest, ...overrideTest, name: this.#name, include: existingTest?.include },
		} as TestProjectInlineConfiguration;
		return this;
	}

	addInclude(...patterns: string[]): this {
		const { test: existingTest, ...rest } = this.#config;
		this.#config = {
			...rest,
			test: { ...existingTest, include: [...(existingTest?.include ?? []), ...patterns] },
		} as TestProjectInlineConfiguration;
		return this;
	}

	addExclude(...patterns: string[]): this {
		const { test: existingTest, ...rest } = this.#config;
		this.#config = {
			...rest,
			test: { ...existingTest, exclude: [...(existingTest?.exclude ?? []), ...patterns] },
		} as TestProjectInlineConfiguration;
		return this;
	}

	addCoverageExclude(...patterns: string[]): this {
		this.#coverageExcludes.push(...patterns);
		return this;
	}

	static unit(options: VitestProjectOptions): VitestProject {
		return new VitestProject({ ...options, kind: "unit" }, { test: { environment: "node" } });
	}

	static e2e(options: VitestProjectOptions): VitestProject {
		const concurrency = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
		return new VitestProject(
			{ ...options, kind: "e2e" },
			{ test: { environment: "node", testTimeout: 120_000, hookTimeout: 60_000, maxConcurrency: concurrency } },
		);
	}

	static int(options: VitestProjectOptions): VitestProject {
		const concurrency = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
		return new VitestProject(
			{ ...options, kind: "int" },
			{ test: { environment: "node", testTimeout: 60_000, hookTimeout: 30_000, maxConcurrency: concurrency } },
		);
	}

	static custom(kind: VitestProjectKind, options: VitestProjectOptions): VitestProject {
		return new VitestProject({ ...options, kind }, {});
	}
}
