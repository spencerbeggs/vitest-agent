/**
 * T10 — MCP resource annotations.
 *
 * Schema decode tests for ResourceAnnotations / ManifestPage /
 * PatternEntry. Annotations are an additive, optional field; partial
 * manifests must decode cleanly during a per-page editorial pass.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ManifestPage,
	PatternEntry,
	ResourceAnnotations,
	decodePatternsManifest,
	decodeUpstreamManifest,
} from "../src/resources/manifest-schema.js";

const decodeAnnotations = Schema.decodeUnknownSync(ResourceAnnotations);
const decodeManifestPage = Schema.decodeUnknownSync(ManifestPage);
const decodePatternEntry = Schema.decodeUnknownSync(PatternEntry);

describe("ResourceAnnotations decode", () => {
	it("accepts the empty object (both sub-fields optional)", () => {
		expect(decodeAnnotations({})).toEqual({});
	});

	it("accepts audience-only annotations", () => {
		const decoded = decodeAnnotations({ audience: ["assistant"] });
		expect(decoded.audience).toEqual(["assistant"]);
		expect(decoded.priority).toBeUndefined();
	});

	it("accepts priority-only annotations", () => {
		const decoded = decodeAnnotations({ priority: 0.85 });
		expect(decoded.priority).toBe(0.85);
		expect(decoded.audience).toBeUndefined();
	});

	it("accepts the documented canonical shape", () => {
		const decoded = decodeAnnotations({ audience: ["assistant"], priority: 0.9 });
		expect(decoded).toEqual({ audience: ["assistant"], priority: 0.9 });
	});

	it("accepts priority at the inclusive bounds", () => {
		expect(decodeAnnotations({ priority: 0 }).priority).toBe(0);
		expect(decodeAnnotations({ priority: 1 }).priority).toBe(1);
	});

	it("rejects priority above 1", () => {
		expect(() => decodeAnnotations({ priority: 1.5 })).toThrow();
	});

	it("rejects priority below 0", () => {
		expect(() => decodeAnnotations({ priority: -0.1 })).toThrow();
	});

	it("rejects priority as a string", () => {
		expect(() => decodeAnnotations({ priority: "0.5" })).toThrow();
	});

	it("rejects audience entries outside the literal union", () => {
		expect(() => decodeAnnotations({ audience: ["robot"] })).toThrow();
	});
});

describe("ManifestPage decode with annotations", () => {
	const base = {
		path: "api/expect",
		title: "expect",
		description: "Vitest expect API: matchers, assertion helpers, custom matchers, snapshot integration.",
	};

	it("decodes a page without annotations (backward compatible)", () => {
		const decoded = decodeManifestPage(base);
		expect(decoded.annotations).toBeUndefined();
	});

	it("decodes a page with full annotations", () => {
		const decoded = decodeManifestPage({
			...base,
			annotations: { audience: ["assistant"], priority: 0.9 },
		});
		expect(decoded.annotations).toEqual({ audience: ["assistant"], priority: 0.9 });
	});

	it("decodes the full manifest with mixed annotated and non-annotated pages", async () => {
		const fixture = {
			tag: "v4.1.0",
			commitSha: "abc1234567890def",
			capturedAt: "2026-05-14T00:00:00Z",
			source: "https://github.com/vitest-dev/vitest",
			pages: [
				{ ...base, annotations: { audience: ["assistant"], priority: 0.9 } },
				{ path: "guide/cli", title: "CLI", description: "Vitest CLI flags, programmatic invocation." },
			],
		};
		const decoded = await Effect.runPromise(decodeUpstreamManifest(fixture));
		expect(decoded.pages).toHaveLength(2);
		expect(decoded.pages?.[0]?.annotations).toBeDefined();
		expect(decoded.pages?.[1]?.annotations).toBeUndefined();
	});
});

describe("PatternEntry decode with annotations", () => {
	const base = {
		slug: "testing-effect-services-with-mock-layers",
		title: "Testing Effect Services with Mock Layers",
		summary: "Compose live and test layers, swap platform layers, assert on accumulated writes.",
	};

	it("decodes a pattern without annotations (backward compatible)", () => {
		const decoded = decodePatternEntry(base);
		expect(decoded.annotations).toBeUndefined();
	});

	it("decodes a pattern with full annotations", () => {
		const decoded = decodePatternEntry({
			...base,
			annotations: { audience: ["assistant"], priority: 0.9 },
		});
		expect(decoded.annotations?.priority).toBe(0.9);
	});

	it("rejects a slug with a long run of dashes in linear time (ReDoS regression)", () => {
		// Reject path: a run of dashes followed by a forbidden character.
		// Before the fix the inner class contained `-` AND the separator
		// alternation was `[/-]`, so an input like "--…--!" forced the
		// engine to try Fibonacci-many partitionings of the dash run.
		// After the fix the parse is unambiguous and rejection is linear.
		const malicious = `${"-".repeat(64)}!`;
		const start = Date.now();
		expect(() => decodePatternEntry({ ...base, slug: malicious })).toThrow();
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("accepts the canonical dashed slug shape after the fix", () => {
		// All three shipping slugs use this same shape — confirm the
		// hardened regex still accepts them.
		const decoded = decodePatternEntry({
			...base,
			slug: "testing-effect-services-with-mock-layers",
		});
		expect(decoded.slug).toBe("testing-effect-services-with-mock-layers");
	});

	it("decodes the full patterns manifest", async () => {
		const fixture = {
			patterns: [{ ...base, annotations: { audience: ["assistant"], priority: 0.9 } }],
		};
		const decoded = await Effect.runPromise(decodePatternsManifest(fixture));
		expect(decoded.patterns).toHaveLength(1);
		expect(decoded.patterns[0]?.annotations?.priority).toBe(0.9);
	});
});
