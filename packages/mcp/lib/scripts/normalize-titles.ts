#!/usr/bin/env tsx
// packages/mcp/lib/scripts/normalize-titles.ts
//
// One-shot title-normalizer for the upstream Vitest docs manifest. Reads
// packages/mcp/public/vendor/vitest-docs/manifest.json, produces a patch
// JSON keyed by page path that follows the title hierarchy documented in
// the update-vitest-snapshot skill:
//
//   config/<lower>          -> `config.<camelCase>` (preserves the
//                              camelCase from the current title; topic
//                              pages whose current title starts with
//                              "Configuring" are left bare)
//   api/<symbol>            -> `<symbol>` (bare canonical name)
//   api/advanced/<symbol>   -> `<symbol> (advanced)` (or descriptive
//                              name + "(advanced)")
//   api/browser/<symbol>    -> `<symbol> (browser API)`
//
// The api/ + guide/ overrides live inline in this script. Output goes
// to stdout (pipe into apply-manifest-patches.ts).
//
// Usage: pnpm exec tsx packages/mcp/lib/scripts/normalize-titles.ts > /tmp/title-patches.json

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { decodeUpstreamManifest } from "../../src/resources/manifest-schema.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = join(PKG_DIR, "public", "vendor", "vitest-docs", "manifest.json");

// Hand-curated overrides for api/ and guide/ pages. Anything not listed
// here in those sections keeps its current title.
const OVERRIDES: Record<string, string> = {
	// api/ — bare canonical names
	"api/assert": "assert",
	"api/mock": "MockInstance",
	"api/vi": "vi",
	// api/advanced/ — class or topic name + (advanced)
	"api/advanced/artifacts": "Test artifacts (advanced)",
	"api/advanced/plugin": "Plugin API (advanced)",
	"api/advanced/reporters": "Reporter API (advanced)",
	"api/advanced/runner": "VitestRunner (advanced)",
	"api/advanced/test-case": "TestCase (advanced)",
	"api/advanced/test-collection": "TestCollection (advanced)",
	"api/advanced/test-module": "TestModule (advanced)",
	"api/advanced/test-project": "TestProject (advanced)",
	"api/advanced/test-specification": "TestSpecification (advanced)",
	"api/advanced/test-suite": "TestSuite (advanced)",
	"api/advanced/vitest": "Vitest class (advanced)",
	// api/browser/ — descriptive + (browser API)
	"api/browser/assertions": "DOM assertions (browser API)",
	"api/browser/commands": "Server commands (browser API)",
	"api/browser/context": "vitest/browser exports (browser API)",
	"api/browser/interactivity": "userEvent (browser API)",
	"api/browser/locators": "page locators (browser API)",
	"api/browser/react": "vitest-browser-react (browser API)",
	"api/browser/svelte": "vitest-browser-svelte (browser API)",
	"api/browser/vue": "vitest-browser-vue (browser API)",
	// guide/ — drop redundant parentheticals, normalize Mocking subtree
	"guide/features": "Vitest features overview",
	"guide/cli-generated": "CLI flags reference",
	"guide/debugging": "Debugging tests",
	"guide/environment": "Test environments",
	"guide/extending-matchers": "Extending matchers",
	"guide/migration": "Migration guide (Vitest 4)",
	"guide/parallelism": "Parallelism",
	"guide/projects": "Test projects",
	"guide/test-context": "Test context",
	"guide/testing-types": "Testing types",
	"guide/mocking": "Mocking overview",
	"guide/mocking/classes": "Mocking: classes",
	"guide/mocking/dates": "Mocking: dates",
	"guide/mocking/file-system": "Mocking: file system (memfs)",
	"guide/mocking/functions": "Mocking: functions (vi.fn vs vi.spyOn)",
	"guide/mocking/globals": "Mocking: globals",
	"guide/mocking/modules": "Mocking: modules",
	"guide/mocking/requests": "Mocking: network requests (MSW)",
	"guide/mocking/timers": "Mocking: timers",
	"guide/browser/index": "Browser mode setup",
	"guide/browser/aria-snapshots": "ARIA snapshots (browser, experimental)",
	"guide/browser/component-testing": "Component testing (browser)",
	"guide/browser/multiple-setups": "Multiple browser instances (browser)",
	"guide/browser/trace-view": "Playwright trace files (browser)",
	"guide/browser/visual-regression-testing": "Visual regression testing (browser)",
};

function normalizeConfigTitle(currentTitle: string): string | null {
	// Topic pages: "Configuring X" -> bare descriptive
	if (currentTitle.toLowerCase().startsWith("configuring ")) return currentTitle;
	// Already prefixed (defensive)
	if (currentTitle.startsWith("config.")) return currentTitle;
	// Otherwise prepend `config.` to the existing camelCase title
	return `config.${currentTitle}`;
}

const program = Effect.gen(function* () {
	const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
	const manifest = yield* decodeUpstreamManifest(raw);
	const pages = manifest.pages ?? [];
	const out: Record<string, { title: string }> = {};
	for (const page of pages) {
		const override = OVERRIDES[page.path];
		if (override !== undefined) {
			if (override !== page.title) out[page.path] = { title: override };
			continue;
		}
		if (page.path.startsWith("config/")) {
			const normalized = normalizeConfigTitle(page.title);
			if (normalized && normalized !== page.title) {
				out[page.path] = { title: normalized };
			}
		}
	}
	process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
});

await Effect.runPromise(program);
