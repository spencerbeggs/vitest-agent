// packages/mcp/__test__/content-roots.test.ts
//
// Guard for issue #96: the served corpus (vendored Vitest docs + curated
// patterns) must live under the package-root `public/` directory, because
// that is the only tree `@savvy-web/bundler` mirrors into the build output
// (`dist/<env>/pkg/public/`). If the corpus drifts back under `src/`, the
// built/published package ships no `manifest.json` / `_meta.json` and every
// `vitest://docs/` and `vitest-agent://patterns/` read fails at runtime with
// an opaque ENOENT. This test fails CI before that reaches a consumer.
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveContentRoots } from "../src/resources/index.js";

describe("served corpus content roots", () => {
	const { vendorRoot, patternsRoot } = resolveContentRoots();

	it("resolves both roots inside the bundler-synced public/ directory", () => {
		expect(vendorRoot.split(sep)).toContain("public");
		expect(patternsRoot.split(sep)).toContain("public");
	});

	it("ships the upstream docs index (vendor/vitest-docs/manifest.json)", () => {
		expect(existsSync(join(vendorRoot, "manifest.json"))).toBe(true);
	});

	it("ships the patterns index (patterns/_meta.json)", () => {
		expect(existsSync(join(patternsRoot, "_meta.json"))).toBe(true);
	});
});
