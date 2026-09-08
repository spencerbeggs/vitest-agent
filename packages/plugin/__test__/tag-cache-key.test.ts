import { describe, expect, it } from "vitest";
import { makeTagCacheKeyGenerator, tagCacheKey } from "../src/utils/tag-cache-key.js";

describe("tagCacheKey", () => {
	it("is order-independent and stable", () => {
		expect(tagCacheKey(["unit", "int"])).toBe(tagCacheKey(["int", "unit"]));
		expect(tagCacheKey(["unit"])).toBe("vitest-agent:tags:unit");
	});
	it("differs when the tag set differs", () => {
		expect(tagCacheKey(["unit"])).not.toBe(tagCacheKey(["custom"]));
	});
});

describe("makeTagCacheKeyGenerator", () => {
	const gen = makeTagCacheKeyGenerator((id) => (id.endsWith(".test.ts") ? ["unit"] : undefined));
	it("returns undefined for ids the transform does not touch", () => {
		expect(gen({ id: "/repo/src/thing.ts" })).toBeUndefined();
	});
	it("returns the tag key for classified ids", () => {
		expect(gen({ id: "/repo/src/thing.test.ts" })).toBe("vitest-agent:tags:unit");
	});
});
