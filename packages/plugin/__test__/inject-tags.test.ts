import { describe, expect, it } from "vitest";
import { injectTags } from "../src/utils/inject-tags.js";

const stripWs = (s: string) => s.replace(/\s+/g, " ").trim();

describe("injectTags", () => {
	it("adds options when test() has only name + fn", () => {
		const out = injectTags(`test("a", () => {});`, ["int"]);
		expect(stripWs(out!.code)).toContain('test("a", { tags: ["int"] }, () =>');
	});

	it("merges into existing options object that has no tags field", () => {
		const out = injectTags(`test("a", { timeout: 100 }, () => {});`, ["int"]);
		expect(stripWs(out!.code)).toMatch(/test\("a",\s*\{\s*timeout:\s*100,\s*tags:\s*\["int"\]\s*\}/);
	});

	it("leaves the call alone when an existing tags field is present", () => {
		const src = `test("a", { tags: ["custom"] }, () => {});`;
		const out = injectTags(src, ["int"]);
		expect(out).toBeNull();
	});

	it("rewrites it() the same as test()", () => {
		const out = injectTags(`it("a", () => {});`, ["int"]);
		expect(stripWs(out!.code)).toContain('it("a", { tags: ["int"] },');
	});

	it("rewrites test.only / test.skip / test.fails", () => {
		for (const variant of ["test.only", "test.skip", "test.fails"]) {
			const out = injectTags(`${variant}("a", () => {});`, ["int"]);
			expect(stripWs(out!.code)).toContain(`${variant}("a", { tags: ["int"] },`);
		}
	});

	it("descends into describe() bodies", () => {
		const src = `describe("g", () => { test("a", () => {}); test("b", () => {}); });`;
		const out = injectTags(src, ["int"]);
		expect(out!.code.match(/tags:\s*\["int"\]/g)?.length).toBe(2);
	});

	it("handles async test functions", () => {
		const out = injectTags(`test("a", async () => {});`, ["int"]);
		expect(stripWs(out!.code)).toContain('test("a", { tags: ["int"] }, async () =>');
	});

	it("returns null when there are no test/it calls", () => {
		const out = injectTags(`export const x = 1;`, ["int"]);
		expect(out).toBeNull();
	});

	it("returns null on parse failure (defensive — let Vite surface the syntax error)", () => {
		const out = injectTags(`test("a", () => { THIS IS NOT VALID );`, ["int"]);
		expect(out).toBeNull();
	});

	it("encodes multiple tags as a string array", () => {
		const out = injectTags(`test("a", () => {});`, ["int", "slow"]);
		expect(stripWs(out!.code)).toContain('tags: ["int", "slow"]');
	});
});
