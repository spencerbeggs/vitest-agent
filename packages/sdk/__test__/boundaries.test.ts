import { builtinModules } from "node:module";
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

describe("@vitest-agent/sdk is a platform-free core", () => {
	it("no file under src/ reads process or imports node built-ins, @effect/platform-node, @effect/sql-sqlite-node or @effected/*", async () => {
		// Positive control: the scanner still flags and spares what its shipped fixtures say it must.
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
		const scan = await Effect.runPromise(
			SourceBoundary.scan({
				root: SRC_ROOT,
				rules: [
					"process",
					"node:process",
					{
						// `node:*` alone misses a bare built-in such as `"fs"`; spread Node's own list.
						forbidImports: [
							"node:*",
							...builtinModules,
							"@effect/platform-node",
							"@effect/sql-sqlite-node",
							"@effected/*",
						],
					},
					{ forbidTokens: [VERSION_TOKEN] },
				],
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
