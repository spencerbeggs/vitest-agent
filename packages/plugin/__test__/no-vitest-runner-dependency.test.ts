import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

function collectSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectSourceFiles(full));
		} else if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

describe("@vitest/runner is not a dependency of @vitest-agent/plugin", () => {
	it("no source file imports @vitest/runner", () => {
		const offenders = collectSourceFiles(join(PKG_ROOT, "src")).filter((file) =>
			readFileSync(file, "utf8").includes("@vitest/runner"),
		);
		expect(offenders).toEqual([]);
	});

	it("package.json declares no @vitest/runner dependency in any block", () => {
		const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as Record<
			string,
			Record<string, string> | undefined
		>;
		for (const block of ["dependencies", "devDependencies", "peerDependencies"]) {
			expect(Object.keys(pkg[block] ?? {})).not.toContain("@vitest/runner");
		}
	});

	it("savvy.build.ts does not externalize @vitest/runner", () => {
		const build = readFileSync(join(PKG_ROOT, "savvy.build.ts"), "utf8");
		expect(build).not.toContain("@vitest/runner");
	});

	it("TestTagDefinition is imported from vitest/config in every consumer", () => {
		const consumers = [
			"src/plugin.ts",
			"src/utils/tag.ts",
			"src/utils/discover-strategy.ts",
			"src/utils/discover-projects.ts",
		];
		for (const rel of consumers) {
			const source = readFileSync(join(PKG_ROOT, rel), "utf8");
			expect(source).toMatch(/import type \{[^}]*\bTestTagDefinition\b[^}]*\} from "vitest\/config"/);
		}
	});
});
