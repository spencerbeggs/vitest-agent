import { describe, expect, it } from "vitest";
import { injectTags } from "../src/utils/inject-tags.js";

describe("injectTags", () => {
	it("prepends the TestRunner prelude before the untouched source", () => {
		const source = 'import { test } from "vitest";\ntest("a", () => {});\n';
		const out = injectTags(source, ["int"]);
		expect(out).not.toBeNull();
		expect(out!.code.startsWith('import * as __vitestAgentVitest from "vitest";\n')).toBe(true);
		expect(out!.code.endsWith(source)).toBe(true);
	});

	it("does not rewrite test() call arguments", () => {
		const source = 'test("a", () => {});';
		const out = injectTags(source, ["int"]);
		expect(out!.code).toContain('test("a", () => {});');
		expect(out!.code).not.toContain('test("a", { tags');
	});

	it("embeds a single tag as a JSON string array spread", () => {
		const out = injectTags('test("a", () => {});', ["int"]);
		expect(out!.code).toContain('...["int"]');
	});

	it("embeds multiple tags in order", () => {
		const out = injectTags('test("a", () => {});', ["int", "slow"]);
		expect(out!.code).toContain('...["int", "slow"]');
	});

	it("JSON-escapes tag names", () => {
		const out = injectTags('test("a", () => {});', ['we"ird']);
		expect(out!.code).toContain(String.raw`...["we\"ird"]`);
	});

	it("guards the runtime mutation in try/catch and unions with existing tags", () => {
		const out = injectTags('test("a", () => {});', ["int"]);
		expect(out!.code).toContain("try {");
		expect(out!.code).toContain("} catch {}");
		expect(out!.code).toContain("__vitestAgentVitest.TestRunner?.getCurrentSuite?.()");
		expect(out!.code).toContain("__vitestAgentCollector?.suite ?? __vitestAgentCollector?.file");
		expect(out!.code).toContain("new Set([...(__vitestAgentTask.tags ?? []),");
	});

	it("injects even when the source has no statically visible test calls", () => {
		const out = injectTags("export const registerSuite = () => {};", ["int"]);
		expect(out).not.toBeNull();
		expect(out!.code).toContain("__vitestAgentVitest");
	});

	it("returns null when tags are empty", () => {
		expect(injectTags('test("a", () => {});', [])).toBeNull();
	});

	it("returns a source map", () => {
		const out = injectTags('test("a", () => {});', ["int"]);
		expect(out!.map).toBeDefined();
		expect(out!.map.mappings.length).toBeGreaterThan(0);
	});
});
