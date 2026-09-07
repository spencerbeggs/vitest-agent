import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_CONFIG = join(HERE, "..", "..", "..", "vitest.config.ts");

function readExcludeEntries(): string[] {
	const source = readFileSync(ROOT_CONFIG, "utf8");
	const start = source.indexOf("exclude: [");
	if (start === -1) throw new Error("coverage.exclude array not found in vitest.config.ts");
	const end = source.indexOf("]", start);
	const body = source.slice(start + "exclude: [".length, end);
	return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("root vitest.config.ts coverage.exclude", () => {
	it("has at least the known entries", () => {
		expect(readExcludeEntries().length).toBeGreaterThanOrEqual(11);
	});

	it("anchors every pattern with **/ so it matches from each project root under Vitest 5", () => {
		// Vitest 5 matches coverage.exclude relative to each project's root
		// (packages/<name>/), so a workspace-anchored "packages/…" pattern can
		// never match from inside the package it names.
		const offenders = readExcludeEntries().filter((p) => !p.startsWith("**/"));
		expect(offenders).toEqual([]);
	});
});
