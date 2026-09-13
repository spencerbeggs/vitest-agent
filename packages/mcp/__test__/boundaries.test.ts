import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_TOKEN, importSpecifiers, referencesProcess, walkTs } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const rel = (file: string): string => relative(SRC_ROOT, file);

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
 * Files allowed to reference the global `process` object: the bin shim, the
 * assembled program that owns the process, the build-time version literal,
 * and `tools/run-tests.ts`, which mutates `process.env.VITEST_AGENT_*` so
 * the in-process Vitest reporter attributes the run to the active agent.
 * Everything else under `src/` must be process-free.
 */
const isAllowlisted = (relPath: string): boolean =>
	relPath === "bin.ts" || relPath === "main.ts" || relPath === "version.ts" || relPath === `tools${"/"}run-tests.ts`;

describe("@vitest-agent/mcp process boundary and forbidden imports", () => {
	const files = walkTs(SRC_ROOT);

	it("no file under src/ reads process outside the allowlist (bin.ts, main.ts, version.ts, tools/run-tests.ts)", () => {
		const offenders = files.filter((f) => {
			const relPath = rel(f);
			if (isAllowlisted(relPath)) return false;
			return referencesProcess(readFileSync(f, "utf8"));
		});
		expect(offenders.map(rel)).toEqual([]);

		const tokenUsers = files.filter((f) => readFileSync(f, "utf8").includes(VERSION_TOKEN)).map(rel);
		expect(tokenUsers).toEqual(["version.ts"]);
	});

	it("no file under src/ imports the sibling runtime packages or the retired MCP SDK / tRPC / zod", () => {
		const forbidden = (s: string) => FORBIDDEN_PACKAGES.some((pkg) => s === pkg || s.startsWith(`${pkg}/`));
		const offenders = files.flatMap((f) =>
			importSpecifiers(readFileSync(f, "utf8"))
				.filter(forbidden)
				.map((s) => `${rel(f)}: ${s}`),
		);
		expect(offenders).toEqual([]);
	});
});
