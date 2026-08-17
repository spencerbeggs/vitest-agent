import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProjects } from "../src/utils/discover-projects.js";
import { DefaultDiscoverStrategy, DiscoverStrategy } from "../src/utils/discover-strategy.js";
import { Tag } from "../src/utils/tag.js";

// An empty workspace for the custom-strategy tests: scanning the real repo
// root with a strategy that declines every package would fire the declined-
// package stderr warning (issue #229) for each real package and leak it into
// the run output.
async function makeEmptyWorkspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "vitest-agent-tags-"));
	await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
	return dir;
}

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
		const cwd = await makeEmptyWorkspace();
		try {
			const result = await discoverProjects({ strategy: custom, cwd });
			expect(result.tags).toEqual([]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("should surface custom tag definitions from a custom strategy", async () => {
		const SoloTag = Tag.make("solo");
		const strategy = DiscoverStrategy.create({
			tags: [SoloTag],
			classify: () => ["solo"],
			buildProject: async () => null,
		});
		const cwd = await makeEmptyWorkspace();
		try {
			const result = await discoverProjects({ strategy, cwd });
			expect(result.tags.map((t) => t.name)).toEqual(["solo"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
