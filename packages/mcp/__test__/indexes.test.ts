// packages/mcp/__test__/indexes.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPatternsIndex, renderUpstreamIndex } from "../src/resources/indexes.js";

describe("renderUpstreamIndex", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "upstream-index-"));
		mkdirSync(join(tmpRoot, "api"), { recursive: true });
		mkdirSync(join(tmpRoot, "guide"), { recursive: true });
		writeFileSync(join(tmpRoot, "api", "mock.md"), "# Mock\n");
		writeFileSync(join(tmpRoot, "api", "vi.md"), "# vi\n");
		writeFileSync(join(tmpRoot, "guide", "test-context.md"), "# Test Context\n");
		writeFileSync(
			join(tmpRoot, "manifest.json"),
			JSON.stringify({ tag: "v4.1.5", commitSha: "abc123", capturedAt: "2026-05-04T00:00:00Z" }),
		);
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("includes the snapshot tag and SHA in the header", async () => {
		const result = await renderUpstreamIndex(tmpRoot);
		expect(result.content).toContain("v4.1.5");
		expect(result.content).toContain("abc123");
	});

	it("groups pages by top-level section", async () => {
		const result = await renderUpstreamIndex(tmpRoot);
		expect(result.content).toContain("## api");
		expect(result.content).toContain("## guide");
	});

	it("emits constructible vitest:// URIs for every page", async () => {
		const result = await renderUpstreamIndex(tmpRoot);
		expect(result.content).toContain("vitest://docs/api/mock");
		expect(result.content).toContain("vitest://docs/api/vi");
		expect(result.content).toContain("vitest://docs/guide/test-context");
	});
});

describe("renderPatternsIndex", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "patterns-index-"));
		writeFileSync(
			join(tmpRoot, "_meta.json"),
			JSON.stringify({
				patterns: [
					{ slug: "first", title: "First Pattern", summary: "Does the first thing." },
					{ slug: "second", title: "Second Pattern", summary: "Does the second thing." },
				],
			}),
		);
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("renders one entry per pattern in order", async () => {
		const result = await renderPatternsIndex(tmpRoot);
		const firstIdx = result.content.indexOf("First Pattern");
		const secondIdx = result.content.indexOf("Second Pattern");
		expect(firstIdx).toBeGreaterThan(-1);
		expect(secondIdx).toBeGreaterThan(firstIdx);
	});

	it("emits constructible vitest-agent:// URIs", async () => {
		const result = await renderPatternsIndex(tmpRoot);
		expect(result.content).toContain("vitest-agent://patterns/first");
		expect(result.content).toContain("vitest-agent://patterns/second");
	});

	it("includes per-pattern summaries", async () => {
		const result = await renderPatternsIndex(tmpRoot);
		expect(result.content).toContain("Does the first thing.");
		expect(result.content).toContain("Does the second thing.");
	});
});
