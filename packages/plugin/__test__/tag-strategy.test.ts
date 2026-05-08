import { describe, expect, it } from "vitest";
import { Tag } from "../src/utils/tag.js";
import { TagStrategy } from "../src/utils/tag-strategy.js";

const moduleInfo = (path: string, packageName = "vitest-agent-sdk") => ({
	path: `/workspace/${path}`,
	relativePath: path,
	filename: path.split("/").pop() ?? path,
	packageName,
	packagePath: `/workspace/${path.split("/").slice(0, 2).join("/")}`,
});

describe("TagStrategy.create", () => {
	const Int = Tag.make("int", { timeout: 60_000 });
	const E2e = Tag.make("e2e", { timeout: 120_000 });

	it("produces an empty tag list when classify returns []", () => {
		const s = TagStrategy.create({
			tags: [Int],
			classify: () => [],
		});
		expect(s.classify({ module: moduleInfo("packages/sdk/src/x.test.ts") })).toEqual([]);
	});

	it("produces tag names from filename matches", () => {
		const s = TagStrategy.create({
			tags: [Int, E2e],
			classify: ({ module }) => {
				if (/\.e2e\.(test|spec)\./.test(module.filename)) return ["e2e"];
				if (/\.int\.(test|spec)\./.test(module.filename)) return ["int"];
				return [];
			},
		});
		expect(s.classify({ module: moduleInfo("packages/sdk/src/auth.int.test.ts") })).toEqual(["int"]);
		expect(s.classify({ module: moduleInfo("packages/sdk/src/auth.e2e.test.ts") })).toEqual(["e2e"]);
		expect(s.classify({ module: moduleInfo("packages/sdk/src/auth.test.ts") })).toEqual([]);
	});

	it("exposes its tag definitions", () => {
		const s = TagStrategy.create({ tags: [Int, E2e], classify: () => [] });
		expect(s.tagDefinitions).toEqual([Int.definition, E2e.definition]);
	});
});

describe("TagStrategy.default", () => {
	const m = (filename: string) => ({
		path: `/w/${filename}`,
		relativePath: filename,
		filename,
		packageName: "x",
		packagePath: "/",
	});

	it("classifies plain test files as unit", () => {
		expect(TagStrategy.default.classify({ module: m("auth.test.ts") })).toEqual(["unit"]);
	});

	it("classifies *.int.test.ts as int", () => {
		expect(TagStrategy.default.classify({ module: m("auth.int.test.ts") })).toEqual(["int"]);
	});

	it("classifies *.e2e.test.ts as e2e", () => {
		expect(TagStrategy.default.classify({ module: m("auth.e2e.test.ts") })).toEqual(["e2e"]);
	});

	it("publishes tag definitions for unit, int, e2e", () => {
		const names = TagStrategy.default.tagDefinitions.map((d) => d.name);
		expect(names).toEqual(["unit", "int", "e2e"]);
	});
});

describe("TagStrategy.extend", () => {
	const m = (filename: string) => ({
		path: `/w/${filename}`,
		relativePath: filename,
		filename,
		packageName: "x",
		packagePath: "/",
	});

	it("chains additionalTags into the strategy", () => {
		const Slow = Tag.make("slow", { timeout: 180_000 });
		const ext = TagStrategy.default.extend({ additionalTags: [Slow] });
		const names = ext.tagDefinitions.map((d) => d.name);
		expect(names).toEqual(["unit", "int", "e2e", "slow"]);
	});

	it("passes inherited from base to extended classify", () => {
		const Slow = Tag.make("slow", { timeout: 180_000 });
		const ext = TagStrategy.default.extend({
			additionalTags: [Slow],
			classify: ({ module, inherited }) => (module.filename.includes(".db.") ? [...inherited, "slow"] : inherited),
		});
		expect(ext.classify({ module: m("auth.db.test.ts") })).toEqual(["unit", "slow"]);
	});

	it("multiple .extend() calls compose left-to-right", () => {
		const A = Tag.make("a");
		const B = Tag.make("b");
		const s = TagStrategy.create({
			tags: [A, B],
			classify: () => ["a"],
		})
			.extend({ classify: ({ inherited }) => [...inherited, "b"] })
			.extend({ classify: ({ inherited }) => inherited.filter((t) => t !== "a") });
		expect(s.classify({ module: m("x") })).toEqual(["b"]);
	});

	it("omitting classify in extend passes inherited through unchanged", () => {
		const ext = TagStrategy.default.extend({ additionalTags: [] });
		expect(ext.classify({ module: m("x.test.ts") })).toEqual(["unit"]);
	});
});
