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

const FRONT_ENDS = [
	"@vitest-agent/cli",
	"@vitest-agent/mcp",
	"@vitest-agent/plugin",
	"@vitest-agent/reporter",
	"@vitest-agent/ui",
];

describe("@vitest-agent/engine never reads process and never imports a front end", () => {
	// Not covered by a source scan: `std-env` (a runtime dependency) reads
	// `process.env` at module load, so the engine's import graph is not
	// process-free even though its own source is.
	it("no file under src/ reads process (no allowlist) or imports @vitest-agent/cli, mcp, plugin, reporter or ui", async () => {
		// Positive control: the scanner still flags and spares what its shipped fixtures say it must.
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
		const scan = await Effect.runPromise(
			SourceBoundary.scan({
				root: SRC_ROOT,
				rules: ["process", "node:process", { forbidImports: FRONT_ENDS }, { forbidTokens: [VERSION_TOKEN] }],
				allowRules: { forbidTokens: ["version.ts"] },
			}).pipe(Effect.provide(NodeServices.layer)),
		);
		// Non-vacuity: a typo'd root would otherwise report a spotless boundary.
		expect(scan.files.length).toBeGreaterThan(0);
		expect(scan.violations).toEqual([]);

		// The version define is live and confined: every use sits in the root
		// version.ts and was waived there, so an empty list would mean the
		// waiver (or the token) no longer matches anything.
		const tokenUses = scan.waived.filter((offence) => offence.rule === "forbidTokens");
		expect(tokenUses.length).toBeGreaterThan(0);
		expect(new Set(tokenUses.map((offence) => offence.file))).toEqual(new Set(["version.ts"]));
	});
});
