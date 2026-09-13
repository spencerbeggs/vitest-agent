import { describe, expect, it } from "vitest";
import { VERSION_TOKEN, importSpecifiers, referencesProcess, walkTs } from "./utils/boundaries.js";

describe("boundaries helper: referencesProcess", () => {
	it("returns false for source with no process reference", () => {
		expect(referencesProcess("export const foo = 1;")).toBe(false);
	});

	it("returns true for a real process.env access", () => {
		expect(referencesProcess("const x = process.env.FOO;")).toBe(true);
	});

	it("ignores a process reference inside a block comment", () => {
		expect(referencesProcess("/* uses process.env.FOO internally */\nexport const foo = 1;")).toBe(false);
	});

	it("ignores a process reference inside a line comment", () => {
		expect(referencesProcess("// process.env.FOO is read elsewhere\nexport const foo = 1;")).toBe(false);
	});

	it("treats a string literal containing process. as a reference (conservative)", () => {
		expect(referencesProcess('const msg = "see process.env for details";')).toBe(true);
	});

	it("exempts only the exact VERSION_TOKEN literal", () => {
		expect(referencesProcess(`export const v = ${VERSION_TOKEN} ?? "0.0.0";`)).toBe(false);
	});

	it("still flags other process access alongside the exempted token", () => {
		expect(referencesProcess(`const v = ${VERSION_TOKEN}; const y = process.exit(1);`)).toBe(true);
	});
});

describe("boundaries helper: importSpecifiers", () => {
	it("surfaces a type-only named import", () => {
		expect(importSpecifiers('import type { X } from "node:fs";')).toEqual(["node:fs"]);
	});

	it("surfaces a dynamic import expression", () => {
		expect(importSpecifiers('const mod = await import("node:path");')).toEqual(["node:path"]);
	});

	it("surfaces both a static and a dynamic import in the same file", () => {
		const source = ['import { readFileSync } from "node:fs";', 'const p = await import("node:path");'].join("\n");
		expect(importSpecifiers(source)).toEqual(["node:fs", "node:path"]);
	});

	it("ignores import specifiers mentioned only inside comments", () => {
		const source = ['// import { X } from "node:fs";', 'export const foo = "node:fs";'].join("\n");
		expect(importSpecifiers(source)).toEqual([]);
	});
});

describe("boundaries helper: walkTs", () => {
	it("collects this package's own test-utils file but excludes .test.ts files", () => {
		const files = walkTs(import.meta.dirname);
		expect(files.some((f) => f.endsWith("utils/boundaries.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith(".test.ts"))).toBe(false);
	});
});
