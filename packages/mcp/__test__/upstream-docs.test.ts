// packages/mcp/__test__/upstream-docs.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUpstreamDoc } from "../src/resources/upstream-docs.js";

describe("readUpstreamDoc", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "upstream-docs-"));
		mkdirSync(join(tmpRoot, "api"), { recursive: true });
		writeFileSync(join(tmpRoot, "api", "mock.md"), "# Mock API\n\nMock body.\n");
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns the markdown body for a known page", async () => {
		const result = await readUpstreamDoc(tmpRoot, "api/mock");
		expect(result.content).toBe("# Mock API\n\nMock body.\n");
		expect(result.mimeType).toBe("text/markdown");
	});

	it("accepts paths with .md extension", async () => {
		const result = await readUpstreamDoc(tmpRoot, "api/mock.md");
		expect(result.content).toBe("# Mock API\n\nMock body.\n");
	});

	it("throws for unknown pages", async () => {
		await expect(readUpstreamDoc(tmpRoot, "api/missing")).rejects.toThrow(/not found/i);
	});

	it("throws for traversal attempts", async () => {
		await expect(readUpstreamDoc(tmpRoot, "../escape")).rejects.toThrow(/path escapes/i);
	});
});
