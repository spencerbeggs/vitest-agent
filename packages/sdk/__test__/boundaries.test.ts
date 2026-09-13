import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_TOKEN, importSpecifiers, referencesProcess, walkTs } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const rel = (file: string): string => relative(SRC_ROOT, file);

describe("@vitest-agent/sdk is a platform-free core", () => {
	const files = walkTs(SRC_ROOT);
	it("no file under src/ references process (version token exempt, only in version.ts)", () => {
		const offenders = files.filter((f) => referencesProcess(readFileSync(f, "utf8")));
		expect(offenders.map(rel)).toEqual([]);
		const tokenUsers = files.filter((f) => readFileSync(f, "utf8").includes(VERSION_TOKEN)).map(rel);
		expect(tokenUsers).toEqual(["version.ts"]);
	});
	it("no file under src/ imports node:*, @effect/platform-node, @effect/sql-sqlite-node or @effected/*", () => {
		const forbidden = (s: string) =>
			s.startsWith("node:") ||
			s.startsWith("@effect/platform-node") ||
			s.startsWith("@effect/sql-sqlite-node") ||
			s.startsWith("@effected/");
		const offenders = files.flatMap((f) =>
			importSpecifiers(readFileSync(f, "utf8"))
				.filter(forbidden)
				.map((s) => `${rel(f)}: ${s}`),
		);
		expect(offenders).toEqual([]);
	});
});
