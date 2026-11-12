import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorkspacePackage, findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const EXACT = "catalog:effected:exact";
const KIT = /^(effect$|@effect\/|@effected\/)/;

/**
 * Every package the carrier installs is tool code: it runs its own copy of
 * `effect` and the `@effected` kit and shares no service, schema or brand with
 * the host app. Its runtime edges onto that family must publish exact
 * versions, so a kit patch never reaches an installed `@vitest-agent/plugin`
 * without a release of it, and the closure can sit beside an app on another
 * kit or Effect release. `catalog:effected` publishes a caret on `@effected/*`,
 * so it does not pin. Peers keep `catalog:effected:peers` ranges: they resolve
 * from the exact copies the carrier declares.
 */
const unpinned = (pkg: WorkspacePackage): ReadonlyArray<string> =>
	(["dependencies", "optionalDependencies"] as const).flatMap((field) =>
		Object.entries(pkg[field])
			.filter(([name, spec]) => KIT.test(name) && spec !== EXACT)
			.map(([name, spec]) => `${pkg.name} ${field}.${name}: ${spec}`),
	);

/** The published packages are exactly the ranked layers of `layers.json`. */
const published = (): ReadonlyArray<WorkspacePackage> => {
	const layers = JSON.parse(readFileSync(resolve(ROOT, "layers.json"), "utf8")) as {
		readonly layers: ReadonlyArray<ReadonlyArray<string>>;
	};
	const names = new Set(layers.layers.flat());
	const root = findWorkspaceRootSync(ROOT, nodeSyncOps);
	if (root === null) throw new Error(`no workspace root above ${ROOT}`);
	return getWorkspacePackagesSync(root, nodeSyncOps).filter((pkg) => names.has(pkg.name));
};

describe("kit closure pins (effected ledger 0011)", () => {
	it("every published package pins its runtime effect, @effect/* and @effected/* dependencies exactly", () => {
		const packages = published();
		// Non-vacuity: a scan that found no packages, or no kit edges, checks nothing.
		expect(packages.map((pkg) => pkg.name)).toContain("@vitest-agent/plugin");
		const edges = packages.flatMap((pkg) =>
			[...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)].filter((name) => KIT.test(name)),
		);
		expect(edges.length).toBeGreaterThan(40);
		expect(packages.flatMap(unpinned)).toEqual([]);
	});

	it("flags a caret catalog on a runtime kit edge and spares peers, devDependencies and other packages (positive control)", () => {
		const pkg = new WorkspacePackage({
			name: "fixture",
			path: "/repo/packages/fixture",
			packageJsonPath: "/repo/packages/fixture/package.json",
			relativePath: "packages/fixture",
			workspaceRoot: "/repo",
			dependencies: {
				effect: EXACT,
				"@effected/kit": "catalog:effected",
				"@effect/platform-node": "4.1.4",
				zod: "catalog:effected",
			},
			optionalDependencies: { "@effected/glob": "^0.21.0" },
			peerDependencies: { "@effected/env": "catalog:effected:peers" },
			devDependencies: { "@effected/memfs": "catalog:effected" },
		});
		expect(unpinned(pkg)).toEqual([
			"fixture dependencies.@effected/kit: catalog:effected",
			"fixture dependencies.@effect/platform-node: 4.1.4",
			"fixture optionalDependencies.@effected/glob: ^0.21.0",
		]);
	});
});
