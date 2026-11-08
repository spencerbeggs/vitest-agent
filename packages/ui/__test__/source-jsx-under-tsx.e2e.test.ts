/**
 * Workspace links resolve to `src/`, and the repo's own `vitest.config.ts`
 * loads the reporter through `--import=tsx`. tsx takes its JSX settings from the
 * tsconfig in the working directory, and only for files that tsconfig includes,
 * so from the repo root it has none for this package's source. Without the
 * `@jsxRuntime automatic` pragma each Ink module carries, they compile to
 * `React.createElement` and the live view stops with "React is not defined",
 * which only a TTY run shows.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

describe("ink source compiled by tsx from the repo root", () => {
	it("uses the automatic JSX runtime", () => {
		const script = `const { StatusIcon } = await import(${JSON.stringify(resolve(REPO_ROOT, "packages/ui/src/ink/StatusIcon.tsx"))}); process.stdout.write(String(StatusIcon));`;
		const result = spawnSync(process.execPath, ["--import=tsx", "--input-type=module", "-e", script], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: { ...process.env, NODE_OPTIONS: "" },
		});

		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("jsx(");
		expect(result.stdout).not.toContain("React.createElement");
	});

	it("every .tsx module carries the pragma", () => {
		const dir = resolve(REPO_ROOT, "packages/ui/src/ink");
		const modules = readdirSync(dir).filter((name) => name.endsWith(".tsx"));

		expect(modules.length).toBeGreaterThan(0);
		for (const name of modules) {
			expect(readFileSync(resolve(dir, name), "utf8"), name).toContain("@jsxRuntime automatic");
		}
	});
});
