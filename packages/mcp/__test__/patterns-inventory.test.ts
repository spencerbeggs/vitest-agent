// packages/mcp/__test__/patterns-inventory.test.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = join(here, "../public/patterns");

interface PatternsMeta {
	patterns: Array<{ slug: string; title: string; summary: string }>;
}

describe("patterns inventory", () => {
	it("_meta.json exists", () => {
		expect(existsSync(join(PATTERNS_DIR, "_meta.json"))).toBe(true);
	});

	it("every entry in _meta has a corresponding markdown file", () => {
		const meta = JSON.parse(readFileSync(join(PATTERNS_DIR, "_meta.json"), "utf8")) as PatternsMeta;
		for (const pattern of meta.patterns) {
			expect(existsSync(join(PATTERNS_DIR, `${pattern.slug}.md`))).toBe(true);
		}
	});

	it("every markdown file has a corresponding entry in _meta", () => {
		const meta = JSON.parse(readFileSync(join(PATTERNS_DIR, "_meta.json"), "utf8")) as PatternsMeta;
		const slugsInMeta = new Set(meta.patterns.map((p) => p.slug));
		const markdownFiles = readdirSync(PATTERNS_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
		for (const file of markdownFiles) {
			expect(slugsInMeta.has(file.replace(/\.md$/, ""))).toBe(true);
		}
	});

	it("at least three launch patterns are present", () => {
		const meta = JSON.parse(readFileSync(join(PATTERNS_DIR, "_meta.json"), "utf8")) as PatternsMeta;
		expect(meta.patterns.length).toBeGreaterThanOrEqual(3);
	});
});
