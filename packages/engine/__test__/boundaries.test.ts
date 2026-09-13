import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_TOKEN, importSpecifiers, referencesProcess, walkTs } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const rel = (file: string): string => relative(SRC_ROOT, file);

const FORBIDDEN_PACKAGES = [
	"@vitest-agent/cli",
	"@vitest-agent/mcp",
	"@vitest-agent/plugin",
	"@vitest-agent/reporter",
	"@vitest-agent/ui",
];

describe("@vitest-agent/engine never reads process and never imports a front end", () => {
	const files = walkTs(SRC_ROOT);

	it("no file under src/ reads process — there is no allowlist (version token exempt, only in version.ts)", () => {
		const offenders = files.filter((f) => referencesProcess(readFileSync(f, "utf8")));
		expect(offenders.map(rel)).toEqual([]);
		const tokenUsers = files.filter((f) => readFileSync(f, "utf8").includes(VERSION_TOKEN)).map(rel);
		expect(tokenUsers).toEqual(["version.ts"]);
	});

	it("no file under src/ imports @vitest-agent/cli, mcp, plugin, reporter or ui", () => {
		const forbidden = (s: string) => FORBIDDEN_PACKAGES.some((pkg) => s === pkg || s.startsWith(`${pkg}/`));
		const offenders = files.flatMap((f) =>
			importSpecifiers(readFileSync(f, "utf8"))
				.filter(forbidden)
				.map((s) => `${rel(f)}: ${s}`),
		);
		expect(offenders).toEqual([]);
	});
});
