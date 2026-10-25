/**
 * `configure` — per-project `test` overrides on `AgentPlugin.discover()` /
 * `discoverProjects()` (issue #626).
 *
 * The generated project for a package is the strategy's business; `configure`
 * lets the root config layer Vitest `test` fields (`isolate`, `pool`, ...)
 * onto a named project without re-deriving the include globs by hand. Driven
 * through the internal `makeDiscoverBuilder` over an `@effected/memfs` volume.
 */
import { describe, expect, it } from "vitest";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { AgentPlugin, makeDiscoverBuilder } from "../src/plugin.js";
import type { DiscoverProjectsOptions } from "../src/utils/discover-projects.js";
import { applyProjectOverrides } from "../src/utils/discover-projects.js";
import { DiscoverStrategy } from "../src/utils/discover-strategy.js";
import type { MemfsWorkspace } from "./utils/memfs-workspace.js";
import { makeMemfsWorkspace } from "./utils/memfs-workspace.js";

const ROOT_FILES = {
	"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
};

const pkgFiles = (name: string): Record<string, string> => ({
	[`packages/${name}/package.json`]: JSON.stringify({ name: `@cfg/${name}`, version: "0.0.0" }),
	[`packages/${name}/__test__/index.test.ts`]: "",
});

const workspace = (): MemfsWorkspace =>
	makeMemfsWorkspace({ ...ROOT_FILES, ...pkgFiles("alpha"), ...pkgFiles("beta") });

const builderFor = (ws: MemfsWorkspace, options: Omit<DiscoverProjectsOptions, "fs" | "syncOps"> = {}) =>
	makeDiscoverBuilder({ cwd: ws.root, ...options, fs: ws.fs, syncOps: ws.syncOps });

const projectNamed = (projects: ReadonlyArray<TestProjectInlineConfiguration> | undefined, name: string) =>
	projects?.find((p) => p.test?.name === name);

describe("discover configure (per-project test overrides)", () => {
	it("merges the override into the named project's test block and leaves name and include intact", async () => {
		const ws = workspace();
		const result = await builderFor(ws, { configure: { "@cfg/alpha": { isolate: false, pool: "threads" } } });

		const alpha = projectNamed(result.projects, "@cfg/alpha");
		expect(alpha?.test?.isolate).toBe(false);
		expect(alpha?.test?.pool).toBe("threads");
		expect(alpha?.test?.name).toBe("@cfg/alpha");
		expect(alpha?.test?.include?.length).toBeGreaterThan(0);
		expect(alpha?.extends).toBe(true);
	});

	it("leaves projects without an override untouched", async () => {
		const ws = workspace();
		const result = await builderFor(ws, { configure: { "@cfg/alpha": { isolate: false } } });

		const beta = projectNamed(result.projects, "@cfg/beta");
		expect(beta?.test?.isolate).toBeUndefined();
		expect(beta?.test?.pool).toBeUndefined();
	});

	it("throws naming the key when a configure key matches no discovered project", async () => {
		const ws = workspace();
		await expect(builderFor(ws, { configure: { "@cfg/typo": { isolate: false } } })).rejects.toThrow(
			/configure.*"@cfg\/typo".*@cfg\/alpha/s,
		);
	});

	it("does not override the name even when the override carries one", async () => {
		// `name` is excluded from the type; a caller casting past it must still not rename a project.
		const configs = [{ extends: true as const, test: { name: "a", include: ["x"] } }];
		const out = applyProjectOverrides(configs, { a: { name: "renamed", isolate: false } as never });
		expect(out[0]?.test?.name).toBe("a");
		expect(out[0]?.test?.isolate).toBe(false);
	});

	it("bypasses the process cache so a different configure map is not served a stale result", async () => {
		const ws = workspace();
		const first = await builderFor(ws, { configure: { "@cfg/alpha": { isolate: false } } });
		const second = await builderFor(ws, { configure: { "@cfg/alpha": { isolate: true } } });
		expect(projectNamed(first.projects, "@cfg/alpha")?.test?.isolate).toBe(false);
		expect(projectNamed(second.projects, "@cfg/alpha")?.test?.isolate).toBe(true);
		expect(first.projects).not.toBe(second.projects);
	});

	it("applies to .addProject() entries by their given name", async () => {
		const ws = makeMemfsWorkspace({ ...ROOT_FILES, "../extra/__test__/index.test.ts": "" });
		const always = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async (input) => ({ extends: true as const, test: { name: input.name, include: [] } }),
		});
		const result = await builderFor(ws, { strategy: always, configure: { extra: { isolate: false } } }).addProject({
			name: "extra",
			path: `${ws.root}/../extra`,
		});
		expect(projectNamed(result.projects, "extra")?.test?.isolate).toBe(false);
	});

	it("AgentPlugin.discover forwards configure through the options object", () => {
		// Type-level + shape check: the public entry accepts the option (resolution needs a real workspace).
		const builder = AgentPlugin.discover({ configure: { "@vitest-agent/sdk": { isolate: false } } });
		expect(typeof builder.then).toBe("function");
	});
});
