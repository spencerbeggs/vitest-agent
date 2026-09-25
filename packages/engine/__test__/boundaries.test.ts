import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** The build-time version define; `SourceBoundary` exempts it anywhere, so its placement is pinned below. */
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
				rules: ["process", "node:process", { forbidImports: FRONT_ENDS }],
			}).pipe(Effect.provide(NodeServices.layer)),
		);
		// Non-vacuity: a typo'd root would otherwise report a spotless boundary.
		expect(scan.files.length).toBeGreaterThan(0);
		expect(scan.violations).toEqual([]);

		const tokenUsers = scan.files.filter((file) => readFileSync(join(SRC_ROOT, file), "utf8").includes(VERSION_TOKEN));
		expect(tokenUsers).toEqual(["version.ts"]);
	});
});
