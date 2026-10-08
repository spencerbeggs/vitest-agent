import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * Importing `@vitest-agent/reporter` must not load React or Ink (issue
 * #562): the agent, CI and piped paths never draw an Ink frame. React and
 * Ink are reached only through the two lazily loaded view modules,
 * `streamView.ts` (the live view's `CliUi.lazyView`) and `humanReport.ts`
 * (the report-time `renderToString`), so nothing else may import `ink`,
 * `react`, `@vitest-agent/ui/ink`, or either view module statically.
 *
 * Dynamic `import(...)` is not a house pattern; these two call sites are
 * its sanctioned exceptions in this package (beside mcp's `main.ts`), so the
 * token is confined to the two files that load a view module.
 */
const scan = SourceBoundary.scan({
	root: SRC_ROOT,
	rules: [
		{ forbidImports: ["ink", "react", "@vitest-agent/ui/ink", "./streamView.js", "./humanReport.js"] },
		{ forbidTokens: ["import("] },
	],
	allowRules: {
		forbidImports: ["streamView.ts", "humanReport.ts", "liveView.ts", "defaultReporter.ts"],
		forbidTokens: ["liveView.ts", "defaultReporter.ts"],
	},
}).pipe(Effect.provide(NodeServices.layer));

describe("@vitest-agent/reporter source boundaries", () => {
	it("the scanner still flags and spares its shipped fixtures", () => {
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
	});

	it("only the two lazy view modules import ink/react, and each is loaded by exactly one dynamic import", async () => {
		const result = await Effect.runPromise(scan);
		expect(result.files).toContain("index.ts");
		expect(result.violations).toEqual([]);
		// Exactly what the waivers are for: the view modules' own ink/react
		// imports, and one dynamic import of each view module. A static import
		// of a view module would drop its `import(` token from this list; an
		// ink/react import anywhere else is a violation above.
		const waived = [
			...new Set(result.waived.map((offence) => `${offence.file} ${offence.rule} ${offence.detail}`)),
		].sort();
		expect(waived).toEqual([
			"defaultReporter.ts forbidImports ./humanReport.js",
			"defaultReporter.ts forbidTokens import(",
			"humanReport.ts forbidImports @vitest-agent/ui/ink",
			"humanReport.ts forbidImports ink",
			"humanReport.ts forbidImports react",
			"liveView.ts forbidImports ./streamView.js",
			"liveView.ts forbidTokens import(",
			"streamView.ts forbidImports @vitest-agent/ui/ink",
			"streamView.ts forbidImports react",
		]);
		// One dynamic import per loading file.
		expect(result.waived.filter((offence) => offence.rule === "forbidTokens")).toHaveLength(2);
	});
});
