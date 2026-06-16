import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceDiscovery, WorkspacePackage } from "workspaces-effect";
import { resolveWorkspaceKey } from "../src/utils/resolve-workspace-key.js";

const makeDiscovery = (packages: ReadonlyArray<WorkspacePackage>) =>
	Layer.succeed(
		WorkspaceDiscovery,
		WorkspaceDiscovery.of({
			listPackages: () => Effect.succeed(packages),
			getPackage: (name) => {
				const found = packages.find((pkg) => pkg.name === name);
				return found ? Effect.succeed(found) : Effect.die(new Error(`getPackage stub: ${name} not configured`));
			},
			importerMap: () => Effect.succeed(new Map()),
			refresh: () => Effect.void,
		}),
	);

const rootPkg = (name: string) =>
	new WorkspacePackage({
		name,
		version: "0.0.0",
		path: "/repo",
		packageJsonPath: "/repo/package.json",
		relativePath: ".",
	});

const childPkg = (name: string, relativePath: string) =>
	new WorkspacePackage({
		name,
		version: "0.0.0",
		path: `/repo/${relativePath}`,
		packageJsonPath: `/repo/${relativePath}/package.json`,
		relativePath,
	});

const run = <A, E>(effect: Effect.Effect<A, E, WorkspaceDiscovery>, packages: ReadonlyArray<WorkspacePackage>) =>
	Effect.runPromise(effect.pipe(Effect.provide(makeDiscovery(packages))) as Effect.Effect<A, E, never>);

describe("resolveWorkspaceKey", () => {
	it("returns the normalized name of the root workspace", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), [rootPkg("my-app")]);
		expect(result).toBe("my-app");
	});

	it("normalizes scoped names by replacing the slash", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), [rootPkg("@org/pkg")]);
		expect(result).toBe("@org__pkg");
	});

	it("ignores non-root workspace packages", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), [
			childPkg("@org/child-a", "packages/child-a"),
			rootPkg("@org/root"),
			childPkg("@org/child-b", "packages/child-b"),
		]);
		expect(result).toBe("@org__root");
	});

	it("fails with WorkspaceRootNotFoundError when no root package is found", async () => {
		const promise = run(resolveWorkspaceKey("/repo"), [
			childPkg("@org/child-a", "packages/child-a"),
			childPkg("@org/child-b", "packages/child-b"),
		]);
		await expect(promise).rejects.toThrow(/Workspace root not found/);
	});

	it("returns the same key for two different projectDirs sharing a workspace name", async () => {
		const a = await run(resolveWorkspaceKey("/code/my-app"), [rootPkg("my-app")]);
		const b = await run(resolveWorkspaceKey("/worktrees/my-app-branch"), [rootPkg("my-app")]);
		expect(a).toBe(b);
	});
});
