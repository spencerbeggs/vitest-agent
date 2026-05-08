import { describe, expect, it } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { Tag } from "../src/utils/tag.js";
import { TagStrategy } from "../src/utils/tag-strategy.js";

describe("discoverProjects (consolidated + tags)", () => {
	it("returns { projects, tags } and emits one project per workspace package", async () => {
		const result = await discoverProjects();
		expect(result).toHaveProperty("projects");
		expect(result).toHaveProperty("tags");
		const names = result.projects.map((p) => p.toConfig().test?.name);
		expect(names.every((n) => typeof n === "string" && !n!.includes(":"))).toBe(true);
	});

	it("default tagStrategy surfaces unit/int/e2e tag definitions", async () => {
		const result = await discoverProjects();
		const tagNames = result.tags.map((t) => t.name);
		expect(tagNames).toEqual(["unit", "int", "e2e"]);
	});

	it("tagStrategy: false yields tags === []", async () => {
		const result = await discoverProjects({ tagStrategy: false });
		expect(result.tags).toEqual([]);
	});

	it("a custom strategy's tag definitions surface", async () => {
		const custom = TagStrategy.create({
			tags: [],
			classify: () => [],
		});
		const result = await discoverProjects({ tagStrategy: custom });
		expect(result.tags).toEqual([]);
	});

	it("invokes callback and applies custom tagStrategy when both are passed", async () => {
		const SoloTag = Tag.make("solo");
		const strategy = TagStrategy.create({ tags: [SoloTag], classify: () => ["solo"] });
		let received: ReadonlyArray<unknown> | null = null;
		const result = await discoverProjects({
			callback: ({ projects }) => {
				received = projects;
			},
			tagStrategy: strategy,
		});
		expect(received).not.toBeNull();
		expect(received!.length).toBe(result.projects.length);
		expect(result.tags.map((t) => t.name)).toEqual(["solo"]);
	});
});
