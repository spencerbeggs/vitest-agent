// packages/mcp/__test__/patterns.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPattern } from "../src/resources/patterns.js";

describe("readPattern", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "patterns-"));
		writeFileSync(join(tmpRoot, "testing-effect-services-with-mock-layers.md"), "# Testing Effect Services\n\nBody.\n");
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns the markdown body for a known slug", async () => {
		const result = await readPattern(tmpRoot, "testing-effect-services-with-mock-layers");
		expect(result.content).toBe("# Testing Effect Services\n\nBody.\n");
		expect(result.mimeType).toBe("text/markdown");
	});

	it("throws for unknown slugs with a hint", async () => {
		await expect(readPattern(tmpRoot, "nope")).rejects.toThrow(/not found.*vitest-agent:\/\/patterns\//i);
	});

	it("throws for slugs containing path separators", async () => {
		await expect(readPattern(tmpRoot, "foo/bar")).rejects.toThrow(/invalid slug/i);
	});
});
