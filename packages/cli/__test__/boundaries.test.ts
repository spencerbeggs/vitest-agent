import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * The build-time version define. `SourceBoundary`'s `"process"` rule exempts
 * it anywhere, so a `forbidTokens` rule confines it to the root `version.ts`
 * (a bare glob matches at the scan root only).
 */
const VERSION_TOKEN = "process.env.__PACKAGE_VERSION__";

const FORBIDDEN_PACKAGES = ["@vitest-agent/mcp", "@vitest-agent/plugin", "@vitest-agent/reporter", "@vitest-agent/ui"];

/**
 * Files allowed to reference the global `process` object: the assembled
 * program that owns the process, and the thin `effect/unstable/cli` command
 * wrappers that read `process.env` / `process.cwd()` to thread ambient input
 * into the engine's pure programs. `bin.ts` and `version.ts` need no entry
 * (the shim reads nothing; the version define is exempt). The waiver is
 * per-rule, so these files are still checked for forbidden imports.
 */
const PROCESS_ALLOWLIST = ["main.ts", "commands/**"];

describe("@vitest-agent/cli process boundary and forbidden imports", () => {
	it("process is read only on the allowlist (main.ts, commands/**) and nothing imports mcp, plugin, reporter or ui", async () => {
		// Positive control: the scanner still flags and spares what its shipped fixtures say it must.
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
		const scan = await Effect.runPromise(
			SourceBoundary.scan({
				root: SRC_ROOT,
				rules: ["process", "node:process", { forbidImports: FORBIDDEN_PACKAGES }, { forbidTokens: [VERSION_TOKEN] }],
				allowRules: {
					process: PROCESS_ALLOWLIST,
					"node:process": PROCESS_ALLOWLIST,
					forbidTokens: ["version.ts"],
				},
			}).pipe(Effect.provide(NodeServices.layer)),
		);
		// Non-vacuity: a typo'd root would otherwise report a spotless boundary.
		expect(scan.files.length).toBeGreaterThan(0);
		expect(scan.violations).toEqual([]);
		// The waiver is live: main.ts really does read process, so an empty
		// `waived` would mean the allowlist no longer matches anything.
		expect(scan.waived.some((offence) => offence.file === "main.ts")).toBe(true);

		// The version define is live and confined: every use sits in the root
		// version.ts and was waived there, so an empty list would mean the
		// waiver (or the token) no longer matches anything.
		const tokenUses = scan.waived.filter((offence) => offence.rule === "forbidTokens");
		expect(tokenUses.length).toBeGreaterThan(0);
		expect(new Set(tokenUses.map((offence) => offence.file))).toEqual(new Set(["version.ts"]));
	});
});
