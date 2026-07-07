import { describe, expect, it } from "vitest";
import { AgentPlugin, DefaultDiscoverStrategy, DiscoverStrategy, Tag } from "../src/index.js";

const callTransform = (
	plugin: ReturnType<typeof AgentPlugin>,
	code: string,
	id: string,
): { code: string; map: unknown } | null => {
	const transform = (plugin as { transform?: (code: string, id: string) => unknown }).transform;
	if (typeof transform !== "function") return null;
	return transform.call(plugin, code, id) as { code: string; map: unknown } | null;
};

describe("AgentPlugin transform hook", () => {
	const TEST_ID = "/repo/packages/sdk/src/auth.int.test.ts";

	it("prepends the tag prelude carrying the int tag", () => {
		const plugin = AgentPlugin();
		const source = 'import { test } from "vitest";\ntest("a", () => {});\n';
		const result = callTransform(plugin, source, TEST_ID);
		expect(result).not.toBeNull();
		expect(result!.code).toContain("__vitestAgentVitest");
		expect(result!.code).toContain('...["int"]');
		expect(result!.code).toContain(source);
	});

	it("returns null for non-test files", () => {
		const plugin = AgentPlugin();
		const result = callTransform(plugin, "export const x = 1;", "/repo/packages/sdk/src/auth.ts");
		expect(result).toBeNull();
	});

	it("returns null when classify yields no tags", () => {
		const plugin = AgentPlugin({
			discoverStrategy: DiscoverStrategy.create({
				tags: [],
				classify: () => [],
				buildProject: async () => null,
			}),
		});
		const result = callTransform(plugin, 'test("x", () => {});', "/repo/packages/sdk/src/auth.test.ts");
		expect(result).toBeNull();
	});

	it("does not register a transform when discoverStrategy is false", () => {
		const plugin = AgentPlugin({ discoverStrategy: false });
		expect((plugin as { transform?: unknown }).transform).toBeUndefined();
	});

	it("supports multiple tags from a single classify call", () => {
		const Slow = Tag.make("slow", { timeout: 180_000 });
		const strategy = new DefaultDiscoverStrategy().extend({
			additionalTags: [Slow],
			classify: ({ inherited }) => [...inherited, "slow"],
		});
		const plugin = AgentPlugin({ discoverStrategy: strategy });
		const result = callTransform(plugin, 'test("x", () => {});', TEST_ID);
		expect(result!.code).toContain('...["int", "slow"]');
	});
});
