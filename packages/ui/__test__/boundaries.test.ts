import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * The package root (`src/index.ts`) must never load React or Ink (issue
 * #562): an agent or CI run imports only the root, and React + Ink are
 * about two-thirds of the modules the package would otherwise load. Every
 * Ink-touching module lives under `src/ink/`, the `@vitest-agent/ui/ink`
 * subpath, so the rule is a directory rule: nothing outside `ink/` imports
 * `ink`, `react` (or a subpath such as `react/jsx-runtime`, type-only
 * imports included), or a module under `ink/`.
 */
const FORBIDDEN_OUTSIDE_INK = ["ink", "react", "./ink/*", "../ink/*", "../../ink/*"];

const scan = SourceBoundary.scan({
	root: SRC_ROOT,
	rules: [{ forbidImports: FORBIDDEN_OUTSIDE_INK }],
	allowRules: { forbidImports: ["ink/**"] },
	extensions: [".ts", ".tsx"],
}).pipe(Effect.provide(NodeServices.layer));

describe("@vitest-agent/ui source boundaries", () => {
	it("the scanner still flags and spares its shipped fixtures", () => {
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
	});

	it("nothing outside src/ink/ imports ink, react, or an Ink module", async () => {
		const result = await Effect.runPromise(scan);
		expect(result.files).toContain("index.ts");
		expect(result.files).toContain("ink/index.ts");
		expect(result.violations).toEqual([]);
		// The waiver is live (the Ink modules really do import ink/react) and
		// covers nothing outside src/ink/.
		expect(result.waived.length).toBeGreaterThan(0);
		expect(result.waived.filter((offence) => !offence.file.startsWith("ink/"))).toEqual([]);
	});

	it("every .tsx module lives under src/ink/ (JSX compiles to a react/jsx-runtime import)", async () => {
		const result = await Effect.runPromise(scan);
		expect(result.files.filter((file) => file.endsWith(".tsx") && !file.startsWith("ink/"))).toEqual([]);
	});
});
