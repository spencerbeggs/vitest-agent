import { describe, expect, it } from "vitest";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import { Tag } from "../src/utils/tag.js";
import type { MemfsWorkspace } from "./utils/memfs-workspace.js";
import { makeMemfsWorkspace } from "./utils/memfs-workspace.js";

// Every workspace here is a seeded `@effected/memfs` volume at a fresh virtual
// root (`makeMemfsWorkspace` never reuses one, which keeps `discoverProjects`'
// root-keyed result cache from bleeding between tests). Nothing touches disk.

const ROOT_FILES = {
	"pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
	"package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true }),
};

// An empty workspace for the custom-strategy tests: a strategy that declines
// every package would fire the declined-package stderr warning (issue #229)
// for each package it saw and leak it into the run output.
const makeEmptyWorkspace = (): Promise<MemfsWorkspace> => makeMemfsWorkspace(ROOT_FILES);

// Two packages whose tests span every kind, in both include roots. Every kind
// landing in ONE project per package is what the no-':'-suffix case pins.
const makeTwoPackageWorkspace = (): Promise<MemfsWorkspace> =>
	makeMemfsWorkspace({
		...ROOT_FILES,
		"packages/a/package.json": JSON.stringify({ name: "@test/a", version: "0.0.0" }),
		"packages/a/src/index.test.ts": "",
		"packages/a/src/index.e2e.test.ts": "",
		"packages/b/package.json": JSON.stringify({ name: "@test/b", version: "0.0.0" }),
		"packages/b/__test__/index.test.ts": "",
		"packages/b/__test__/integration/index.int.test.ts": "",
	});

describe("discoverProjects() + DiscoverStrategy (tags)", () => {
	it("should return { projects, tags } shape", async () => {
		const ws = await makeTwoPackageWorkspace();
		const result = await ws.discover();
		expect(result).toHaveProperty("projects");
		expect(result).toHaveProperty("tags");
	});

	it("should emit one project per workspace package (each with test.name, no ':' suffix)", async () => {
		const ws = await makeTwoPackageWorkspace();
		const result = await ws.discover();
		// Positive control: a seeded workspace always has projects, so the name
		// checks below can never pass vacuously.
		expect(result.projects).toBeDefined();
		const names = result.projects?.map((p) => p.test?.name) ?? [];
		expect(names.every((n) => typeof n === "string" && !n?.includes(":"))).toBe(true);
		expect([...names].sort()).toEqual(["@test/a", "@test/b"]);
	});

	it("should surface unit/int/e2e tag definitions from DefaultDiscoverStrategy", async () => {
		const ws = await makeTwoPackageWorkspace();
		const result = await ws.discover({ strategy: new DefaultDiscoverStrategy() });
		const tagNames = result.tags.map((t) => t.name);
		expect(tagNames).toEqual(["unit", "int", "e2e"]);
	});

	it("should surface empty tags when strategy has no tags", async () => {
		const custom = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async () => null,
		});
		const ws = await makeEmptyWorkspace();
		const result = await ws.discover({ strategy: custom });
		expect(result.tags).toEqual([]);
	});

	it("should surface custom tag definitions from a custom strategy", async () => {
		const SoloTag = Tag.make("solo");
		const strategy = DiscoverStrategy.create({
			tags: [SoloTag],
			classify: () => ["solo"],
			buildProject: async () => null,
		});
		const ws = await makeEmptyWorkspace();
		const result = await ws.discover({ strategy });
		expect(result.tags.map((t) => t.name)).toEqual(["solo"]);
	});
});
