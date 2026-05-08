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

	it("should tag test.concurrent.only calls with nested MemberExpression callee", () => {
		// Given: a deeply nested MemberExpression callee test.concurrent.only
		const src = `test.concurrent.only("a", () => {});`;

		// When: injectTags is called
		const out = injectTags(src, ["int"]);

		// Then: the call should be tagged
		expect(out).not.toBeNull();
		expect(stripWs(out!.code)).toContain('tags: ["int"]');
	});

	it('should tag test.skip.if(true)("a", fn) chained pattern', () => {
		// Given: test.skip.if(cond)("name", fn) — a CallExpression whose callee is a
		// nested MemberExpression (test.skip.if), wrapping the outer call
		const src = `test.skip.if(true)("a", () => {});`;

		// When: injectTags is called
		const out = injectTags(src, ["int"]);

		// Then: the call should be tagged
		expect(out).not.toBeNull();
		expect(stripWs(out!.code)).toContain('tags: ["int"]');
	});

	it("should wrap a non-literal options argument with spread when injecting tags", () => {
		// Given: a 3-arg test call where the middle arg is an Identifier (not an ObjectExpression)
		const src = `test("a", opts, () => {});`;

		// When: injectTags is called with a tag
		const out = injectTags(src, ["int"]);

		// Then: the result should use spread to wrap the identifier
		expect(out).not.toBeNull();
		expect(stripWs(out!.code)).toContain('{ ...(opts), tags: ["int"] }');
	});

	it("should wrap a function-call options expression with spread when injecting tags", () => {
		// Given: a 3-arg test call where the middle arg is a CallExpression
		const src = `test("a", makeOpts(123), () => {});`;

		// When: injectTags is called with a tag
		const out = injectTags(src, ["int"]);

		// Then: the result should use spread to wrap the call expression
		expect(out).not.toBeNull();
		expect(stripWs(out!.code)).toContain('{ ...(makeOpts(123)), tags: ["int"] }');
	});

	it("should produce exactly 3 arguments with a spread ObjectExpression after transforming a non-literal options arg", async () => {
		// Given: a 3-arg test call where the middle arg is an Identifier
		const src = `test("a", opts, () => {});`;

		// When: injectTags transforms it
		const out = injectTags(src, ["int"]);
		expect(out).not.toBeNull();

		// Then: parse the output with acorn and verify the AST shape
		const { parse } = await import("acorn");
		const ast = parse(out!.code, { ecmaVersion: "latest", sourceType: "module" }) as unknown as {
			body: Array<{ expression: { arguments: Array<{ type: string; properties: Array<{ type: string }> }> } }>;
		};
		const callArgs = ast.body[0].expression.arguments;

		// exactly 3 arguments (not 4)
		expect(callArgs).toHaveLength(3);

		// second arg is an ObjectExpression
		const secondArg = callArgs[1];
		expect(secondArg.type).toBe("ObjectExpression");

		// first property is a SpreadElement, second is the tags Property
		expect(secondArg.properties[0].type).toBe("SpreadElement");
		expect(secondArg.properties[1].type).toBe("Property");
	});
});
