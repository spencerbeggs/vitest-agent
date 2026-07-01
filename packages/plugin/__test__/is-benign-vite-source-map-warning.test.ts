import { describe, expect, it } from "vitest";
import { isBenignViteSourceMapWarning } from "../src/utils/is-benign-vite-source-map-warning.js";

describe("isBenignViteSourceMapWarning", () => {
	// ── Goal 2, Behavior 3: exact benign message shape ───────────────────────
	it("should return true for the exact benign 'Failed to load source map' ENOENT .js.map message", () => {
		// Given: the exact message shape Vite core emits for a missing .js.map
		const message =
			"Failed to load source map for /repo/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js.\n" +
			"Error: ENOENT: no such file or directory, open '/repo/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js.map'";

		// When: the predicate is evaluated against that message
		const result = isBenignViteSourceMapWarning(message);

		// Then: it is classified as benign
		expect(result).toBe(true);
	});

	// ── Goal 2, Behavior 4: generic unrelated vite warning ───────────────────
	it("should return false for a generic unrelated vite warning", () => {
		// Given: an unrelated Vite warning that has nothing to do with source maps
		const message = "[vite] some other warning";

		// When: the predicate is evaluated against that message
		const result = isBenignViteSourceMapWarning(message);

		// Then: it is NOT classified as benign
		expect(result).toBe(false);
	});

	// ── Goal 2, Behavior 5: unrelated ENOENT, not a .js.map ──────────────────
	it("should return false for an unrelated ENOENT error that does not reference a .js.map file", () => {
		// Given: an ENOENT error against an unrelated file extension
		const message = "Error: ENOENT: no such file or directory, open '/repo/config/some-config.json'";

		// When: the predicate is evaluated against that message
		const result = isBenignViteSourceMapWarning(message);

		// Then: it is NOT classified as benign
		expect(result).toBe(false);
	});

	// ── Goal 2, Behavior 6: empty string ─────────────────────────────────────
	it("should return false for an empty string", () => {
		// Given: an empty message
		const message = "";

		// When: the predicate is evaluated against that message
		const result = isBenignViteSourceMapWarning(message);

		// Then: it is NOT classified as benign
		expect(result).toBe(false);
	});
});
