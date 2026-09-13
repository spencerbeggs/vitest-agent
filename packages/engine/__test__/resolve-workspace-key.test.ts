import { WorkspaceDiscovery, WorkspacePackage, WorkspaceRootNotFoundError } from "@effected/workspaces";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceKey } from "../src/utils/resolve-workspace-key.js";

/**
 * A double for the per-root discovery surface: `roots` maps a workspace root
 * to the packages beneath it, and `listPackagesIn` answers by the same
 * longest-prefix upward walk the real service performs. Stubbing
 * `listPackagesIn` (rather than `listPackages`) is mandatory — the library's
 * `makeTest` refuses to derive it, precisely so a test cannot model every root
 * as identical.
 */
const makeDiscovery = (roots: Readonly<Record<string, ReadonlyArray<WorkspacePackage>>>) =>
	WorkspaceDiscovery.layerTest({
		listPackagesIn: (directory: string) => {
			const root = Object.keys(roots)
				.filter((candidate) => directory === candidate || directory.startsWith(`${candidate}/`))
				.sort((a, b) => b.length - a.length)[0];
			return root === undefined
				? Effect.fail(new WorkspaceRootNotFoundError({ searchPath: directory, markers: [] }))
				: Effect.succeed(roots[root] ?? []);
		},
	});

const rootPkg = (name: string, workspaceRoot = "/repo") =>
	new WorkspacePackage({
		name,
		version: "0.0.0",
		path: workspaceRoot,
		packageJsonPath: `${workspaceRoot}/package.json`,
		relativePath: ".",
		workspaceRoot,
	});

const childPkg = (name: string, relativePath: string, workspaceRoot = "/repo") =>
	new WorkspacePackage({
		name,
		version: "0.0.0",
		path: `${workspaceRoot}/${relativePath}`,
		packageJsonPath: `${workspaceRoot}/${relativePath}/package.json`,
		relativePath,
		workspaceRoot,
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, WorkspaceDiscovery>,
	roots: Readonly<Record<string, ReadonlyArray<WorkspacePackage>>>,
) => Effect.runPromise(effect.pipe(Effect.provide(makeDiscovery(roots))) as Effect.Effect<A, E, never>);

describe("resolveWorkspaceKey", () => {
	it("returns the normalized name of the root workspace", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), { "/repo": [rootPkg("my-app")] });
		expect(result).toBe("my-app");
	});

	it("normalizes scoped names by replacing the slash", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), { "/repo": [rootPkg("@org/pkg")] });
		expect(result).toBe("@org__pkg");
	});

	it("ignores non-root workspace packages", async () => {
		const result = await run(resolveWorkspaceKey("/repo"), {
			"/repo": [
				childPkg("@org/child-a", "packages/child-a"),
				rootPkg("@org/root"),
				childPkg("@org/child-b", "packages/child-b"),
			],
		});
		expect(result).toBe("@org__root");
	});

	it("resolves from a directory nested inside the workspace, not just its root", async () => {
		const result = await run(resolveWorkspaceKey("/repo/packages/child-a/src"), {
			"/repo": [rootPkg("@org/root"), childPkg("@org/child-a", "packages/child-a")],
		});
		expect(result).toBe("@org__root");
	});

	it("fails with WorkspaceRootNotFoundError when no root package is found", async () => {
		const promise = run(resolveWorkspaceKey("/repo"), {
			"/repo": [childPkg("@org/child-a", "packages/child-a"), childPkg("@org/child-b", "packages/child-b")],
		});
		await expect(promise).rejects.toThrow(/No workspace root above/);
	});

	it("propagates WorkspaceRootNotFoundError for a directory in no workspace at all", async () => {
		const promise = run(resolveWorkspaceKey("/elsewhere"), { "/repo": [rootPkg("my-app")] });
		await expect(promise).rejects.toThrow(/No workspace root above/);
	});

	it("returns the same key for two different projectDirs sharing a workspace name", async () => {
		const roots = {
			"/code/my-app": [rootPkg("my-app", "/code/my-app")],
			"/worktrees/my-app-branch": [rootPkg("my-app", "/worktrees/my-app-branch")],
		};
		const a = await run(resolveWorkspaceKey("/code/my-app"), roots);
		const b = await run(resolveWorkspaceKey("/worktrees/my-app-branch"), roots);
		expect(a).toBe(b);
	});

	it("anchors at the supplied directory, so sibling roots resolve to their own keys", async () => {
		const roots = {
			"/code/app-a": [rootPkg("app-a", "/code/app-a")],
			"/code/app-b": [rootPkg("app-b", "/code/app-b")],
		};
		const a = await run(resolveWorkspaceKey("/code/app-a"), roots);
		const b = await run(resolveWorkspaceKey("/code/app-b"), roots);
		expect([a, b]).toEqual(["app-a", "app-b"]);
	});
});
