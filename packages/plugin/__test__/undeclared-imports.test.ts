import { builtinModules } from "node:module";
import { resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { MemoryFileSystem } from "@effected/memfs";
import { WorkspaceDiscovery, WorkspacePackage, Workspaces } from "@effected/workspaces";
import type { UndeclaredScan } from "@effected/workspaces/testing";
import { ImportGraph } from "@effected/workspaces/testing";
import { Effect, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * Test files co-located under `src/` (the playground's) import their
 * devDependencies by design; a runtime-dependency check has nothing to say
 * about them.
 */
const isTestFile = (file: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
const runtimeViolations = (scan: UndeclaredScan) =>
	scan.undeclared.filter((entry) => !isTestFile(entry.file)).map((entry) => entry.label);

/**
 * Every package's runtime sources (`src/**`) import only what its own
 * manifest declares in `dependencies`, `peerDependencies` or
 * `optionalDependencies`. This is the one packaging failure no other suite
 * sees: inside the workspace, Node's upward lookup finds a devDependency (or
 * a package only the root declares) from `dist/` as well as `src/`, so every
 * e2e test passes, and the import breaks only in a consumer's install, where
 * the published manifest has no devDependencies. It replaces the
 * packed-install e2e (issue #574): static, so it runs in milliseconds in the
 * everyday loop instead of ~40 s of packing and four real installs.
 */
describe("undeclared runtime imports (#574)", () => {
	it("every workspace package's runtime imports are declared in its own manifest", async () => {
		const scan = await Effect.runPromise(
			ImportGraph.undeclared({ builtins: builtinModules }).pipe(Effect.provide(Live)),
		);
		// Non-vacuity: a scan that read nothing would report a spotless tree.
		expect(scan.packages).toContain("@vitest-agent/plugin");
		expect(scan.files.length).toBeGreaterThan(100);
		expect(runtimeViolations(scan)).toEqual([]);
	});

	it("flags a runtime import of a devDependency and spares declared, built-in, type-only and test-file imports (positive control)", async () => {
		const pkg = new WorkspacePackage({
			name: "fixture",
			path: "/repo/packages/fixture",
			packageJsonPath: "/repo/packages/fixture/package.json",
			relativePath: "packages/fixture",
			workspaceRoot: "/repo",
			dependencies: { effect: "^4.0.0" },
			devDependencies: { zod: "^4.0.0", vitest: "^5.0.0" },
		});
		const volume = {
			"/repo/packages/fixture/package.json": JSON.stringify({ name: "fixture" }),
			"/repo/packages/fixture/src/index.ts": [
				'import { Effect } from "effect";',
				'import { readFileSync } from "node:fs";',
				'import type { ZodType } from "zod";',
				'import { z } from "zod";',
				"export const all = [Effect, readFileSync, z] as const;",
				"export type Z = ZodType;",
			].join("\n"),
			"/repo/packages/fixture/src/index.test.ts": 'import { it } from "vitest";\nit("x", () => {});\n',
		};
		const scan = await Effect.runPromise(
			ImportGraph.undeclared({ builtins: builtinModules }).pipe(
				Effect.provide(
					Layer.mergeAll(
						MemoryFileSystem.layerWith(volume),
						Path.layer,
						WorkspaceDiscovery.layerTest({ listPackages: () => Effect.succeed([pkg]) }),
					),
				),
			),
		);
		expect(scan.files.length).toBe(2);
		// The runtime `zod` import is the only violation; the type-only one is erased.
		expect(runtimeViolations(scan)).toEqual(["fixture src/index.ts:4:19 undeclared zod"]);
		// The test file's devDependency import is reported by the kit and dropped here.
		expect(scan.undeclared.map((entry) => entry.file)).toContain("src/index.test.ts");
	});
});
