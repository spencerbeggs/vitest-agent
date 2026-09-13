import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_TOKEN, importSpecifiers, referencesProcess, walkTs } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const rel = (file: string): string => relative(SRC_ROOT, file);

const FORBIDDEN_PACKAGES = ["@vitest-agent/mcp", "@vitest-agent/plugin", "@vitest-agent/reporter", "@vitest-agent/ui"];

/**
 * Files allowed to reference the global `process` object: the bin shim, the
 * assembled program that owns the process, the build-time version literal,
 * and the thin `effect/unstable/cli` command wrappers that read
 * `process.env` / `process.cwd()` to thread ambient input into the engine's
 * pure programs. Everything else under `src/` must be process-free.
 */
const isAllowlisted = (relPath: string): boolean =>
	relPath === "bin.ts" || relPath === "main.ts" || relPath === "version.ts" || relPath.startsWith(`commands${"/"}`);

describe("@vitest-agent/cli process boundary and forbidden imports", () => {
	const files = walkTs(SRC_ROOT);

	it("no file under src/ reads process outside the allowlist (bin.ts, main.ts, version.ts, commands/**)", () => {
		const offenders = files.filter((f) => {
			const relPath = rel(f);
			if (isAllowlisted(relPath)) return false;
			return referencesProcess(readFileSync(f, "utf8"));
		});
		expect(offenders.map(rel)).toEqual([]);

		const tokenUsers = files.filter((f) => readFileSync(f, "utf8").includes(VERSION_TOKEN)).map(rel);
		expect(tokenUsers).toEqual(["version.ts"]);
	});

	it("no file under src/ imports @vitest-agent/mcp, plugin, reporter, or ui", () => {
		const forbidden = (s: string) => FORBIDDEN_PACKAGES.some((pkg) => s === pkg || s.startsWith(`${pkg}/`));
		const offenders = files.flatMap((f) =>
			importSpecifiers(readFileSync(f, "utf8"))
				.filter(forbidden)
				.map((s) => `${rel(f)}: ${s}`),
		);
		expect(offenders).toEqual([]);
	});
});
