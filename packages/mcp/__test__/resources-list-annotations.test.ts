/**
 * T10 — list-callback integration check.
 *
 * Confirms the rslib-built MCP module's manifest decode path reads the
 * annotations field from the vendored manifest and that the patterns
 * _meta.json carries annotations too. The full `resources/list` MCP
 * round-trip lives in the manual Phase E capture; this test guards the
 * decode-and-forward seam against a future schema regression.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { decodePatternsManifest, decodeUpstreamManifest } from "../src/resources/manifest-schema.js";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(PKG_DIR, "public", "vendor", "vitest-docs", "manifest.json");
const PATTERNS_META = join(PKG_DIR, "public", "patterns", "_meta.json");

describe("vendored manifest annotations", () => {
	it("decodes without error and every page carries annotations after the editorial pass", async () => {
		const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
		const manifest = await Effect.runPromise(decodeUpstreamManifest(raw));
		const pages = manifest.pages ?? [];
		expect(pages.length).toBeGreaterThan(0);
		const annotated = pages.filter((p) => p.annotations !== undefined);
		expect(annotated.length).toBe(pages.length);
	});

	it("assigns audience: ['assistant'] and priority in [0, 1] for every annotated page", async () => {
		const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
		const manifest = await Effect.runPromise(decodeUpstreamManifest(raw));
		const pages = manifest.pages ?? [];
		for (const page of pages) {
			expect(page.annotations).toBeDefined();
			if (!page.annotations) continue;
			expect(page.annotations.audience).toEqual(["assistant"]);
			expect(page.annotations.priority).toBeGreaterThanOrEqual(0);
			expect(page.annotations.priority).toBeLessThanOrEqual(1);
		}
	});

	it("places api/expect at a high-priority band (>= 0.85)", async () => {
		const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
		const manifest = await Effect.runPromise(decodeUpstreamManifest(raw));
		const page = manifest.pages?.find((p) => p.path === "api/expect");
		expect(page?.annotations?.priority ?? 0).toBeGreaterThanOrEqual(0.85);
	});

	it("places guide/browser pages in the experimental band (<= 0.65)", async () => {
		const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
		const manifest = await Effect.runPromise(decodeUpstreamManifest(raw));
		const browserPages = (manifest.pages ?? []).filter((p) => p.path.startsWith("guide/browser/"));
		expect(browserPages.length).toBeGreaterThan(0);
		for (const page of browserPages) {
			expect(page.annotations?.priority ?? 1).toBeLessThanOrEqual(0.65);
		}
	});
});

describe("patterns _meta annotations", () => {
	it("decodes without error and every pattern carries annotations", async () => {
		const raw = JSON.parse(readFileSync(PATTERNS_META, "utf8")) as unknown;
		const manifest = await Effect.runPromise(decodePatternsManifest(raw));
		expect(manifest.patterns.length).toBeGreaterThan(0);
		for (const pattern of manifest.patterns) {
			expect(pattern.annotations).toBeDefined();
			expect(pattern.annotations?.audience).toEqual(["assistant"]);
			expect(pattern.annotations?.priority).toBeGreaterThanOrEqual(0);
			expect(pattern.annotations?.priority).toBeLessThanOrEqual(1);
		}
	});
});
