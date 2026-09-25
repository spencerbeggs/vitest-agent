import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** The build-time version define; `SourceBoundary` exempts it anywhere, so its placement is pinned below. */
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
				],
			}).pipe(Effect.provide(NodeServices.layer)),
		);
		// Non-vacuity: a typo'd root would otherwise report a spotless boundary.
		expect(scan.files.length).toBeGreaterThan(0);
		expect(scan.violations).toEqual([]);

		const tokenUsers = scan.files.filter((file) => readFileSync(join(SRC_ROOT, file), "utf8").includes(VERSION_TOKEN));
		expect(tokenUsers).toEqual(["version.ts"]);
	});
});
