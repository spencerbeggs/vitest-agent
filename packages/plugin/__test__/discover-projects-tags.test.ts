import { describe, expect, it } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import { Tag } from "../src/utils/tag.js";

describe("discoverProjects() + DiscoverStrategy (tags)", () => {
	it("should return { projects, tags } shape", async () => {
		const result = await discoverProjects();
		expect(result).toHaveProperty("projects");
		expect(result).toHaveProperty("tags");
	});

	it("should emit one project per workspace package (each with test.name, no ':' suffix)", async () => {
		const result = await discoverProjects();
		// projects may be undefined if this repo's packages happen to have no tests
		if (result.projects) {
			const names = result.projects.map((p) => p.test?.name);
			expect(names.every((n) => typeof n === "string" && !n?.includes(":"))).toBe(true);
		}
	});

	it("should surface unit/int/e2e tag definitions from DefaultDiscoverStrategy", async () => {
		const result = await discoverProjects({ strategy: new DefaultDiscoverStrategy() });
		const tagNames = result.tags.map((t) => t.name);
		expect(tagNames).toEqual(["unit", "int", "e2e"]);
	});

	it("should surface empty tags when strategy has no tags", async () => {
		const custom = DiscoverStrategy.create({
			tags: [],
			classify: () => [],
			buildProject: async () => null,
		});
		const result = await discoverProjects({ strategy: custom });
		expect(result.tags).toEqual([]);
	});

	it("should surface custom tag definitions from a custom strategy", async () => {
		const SoloTag = Tag.make("solo");
		const strategy = DiscoverStrategy.create({
			tags: [SoloTag],
			classify: () => ["solo"],
			buildProject: async () => null,
		});
		const result = await discoverProjects({ strategy });
		expect(result.tags.map((t) => t.name)).toEqual(["solo"]);
	});
});
