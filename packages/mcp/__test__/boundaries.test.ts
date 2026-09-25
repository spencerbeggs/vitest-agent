import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/**
 * Packages nothing under `src/` may import: the sibling runtime packages
 * (the mcp server reaches the plugin only through the shared discovery
 * symbol slot, never an import) and the three retired server dependencies.
 */
const FORBIDDEN_PACKAGES = [
	"@vitest-agent/cli",
	"@vitest-agent/plugin",
	"@vitest-agent/reporter",
	"@vitest-agent/ui",
	"@modelcontextprotocol/sdk",
	"@trpc/server",
	"zod",
];

/**
 * stdout is the JSON-RPC wire, so nothing under `src/` writes to it or logs
 * through `console.log`. Only two files may read `process`: `main.ts`, the
 * assembled program that owns the process, and `tools/run-tests.ts`, which
 * mutates `process.env.VITEST_AGENT_*` so the in-process Vitest reporter
 * attributes the run to the active agent, and routes the in-process run's
 * stdout into a per-run sink (the one `stdout-write` waiver). `version.ts`'s
 * `process.env.__PACKAGE_VERSION__` is a build-time literal and is always
 * exempt.
 */
const scan = SourceBoundary.scan({
	root: SRC_ROOT,
	rules: ["process", "stdout-write", "console-stdout", { forbidImports: FORBIDDEN_PACKAGES }],
	allowRules: {
		process: ["main.ts", "tools/run-tests.ts"],
		"stdout-write": ["tools/run-tests.ts"],
	},
}).pipe(Effect.provide(NodeServices.layer));

describe("@vitest-agent/mcp source boundaries", () => {
	it("the scanner still flags and spares its shipped fixtures", () => {
		expect(SourceBoundary.verifyFixtures()).toEqual([]);
	});

	it("src/ keeps stdout clean, reads process only where allowed, and imports no sibling front end", async () => {
		const result = await Effect.runPromise(scan);
		expect(result.files.length).toBeGreaterThan(0);
		expect(result.files).toContain("main.ts");
		expect(result.violations).toEqual([]);
		// Every waiver still waives something, and nothing beyond the two files.
		const waivedFiles = [...new Set(result.waived.map((offence) => `${offence.file} ${offence.rule}`))].sort();
		expect(waivedFiles).toEqual(["main.ts process", "tools/run-tests.ts process", "tools/run-tests.ts stdout-write"]);
	});
});
