import { MemoryFileSystem } from "@effected/memfs";
import { WorkspaceDiscovery, WorkspacePackage, WorkspaceRootNotFoundError } from "@effected/workspaces";
import { Effect, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";
import { ProjectIdentityNotResolvableError } from "../src/errors/ProjectIdentityError.js";
import { ConfigLive } from "../src/layers/ConfigLive.js";
import { ProjectIdentityLive, ProjectIdentityTest } from "../src/layers/ProjectIdentityLive.js";
import { ProjectIdentity } from "../src/services/ProjectIdentity.js";

describe("ProjectIdentityTest layer", () => {
	it("returns the configured ResolvedIdentity from resolve()", async () => {
		const fixed = {
			projectKey: "github.com__foo__bar",
			canonicalForm: "github.com/foo/bar",
			source: "git-remote" as const,
		};
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve("/whatever");
		}).pipe(Effect.provide(ProjectIdentityTest(fixed)));

		const result = await Effect.runPromise(program);
		expect(result).toEqual(fixed);
	});

	it("propagates ProjectIdentityNotResolvableError when configured to fail", async () => {
		const error = new ProjectIdentityNotResolvableError({
			tried: [{ source: "explicit", reason: "not configured" }],
		});
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve("/whatever");
		}).pipe(Effect.provide(ProjectIdentityTest(error)));

		await expect(Effect.runPromise(program)).rejects.toThrow(/Project identity could not be resolved/);
	});

	it("ignores the workspaceRoot argument when fed a fixed result", async () => {
		const fixed = {
			projectKey: "explicit-key",
			canonicalForm: "explicit-key",
			source: "explicit" as const,
		};
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			const a = yield* id.resolve("/path/a");
			const b = yield* id.resolve("/path/b");
			return [a, b];
		}).pipe(Effect.provide(ProjectIdentityTest(fixed)));

		const [a, b] = await Effect.runPromise(program);
		expect(a).toEqual(b);
	});
});

/**
 * A spawner double whose only reachable method is `string`, which stands in
 * for `git config --get remote.origin.url`. Every other method throws rather
 * than answering: `collectCandidates` must not reach them, and a silent
 * default would hide it if it did.
 */
const unstubbed = (method: string) => (): never => {
	throw new Error(`ChildProcessSpawner double: ${method}() is not stubbed`);
};

const noGitRemoteSpawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
	spawn: unstubbed("spawn"),
	exitCode: unstubbed("exitCode"),
	streamString: unstubbed("streamString"),
	streamLines: unstubbed("streamLines"),
	lines: unstubbed("lines"),
	string: () => Effect.succeed(""),
});

const rootOf = (name: string, workspaceRoot: string) =>
	new WorkspacePackage({
		name,
		version: "0.0.0",
		path: workspaceRoot,
		packageJsonPath: `${workspaceRoot}/package.json`,
		relativePath: ".",
		workspaceRoot,
	});

const APP_A = "/code/app-a";
const APP_B = "/code/app-b";

/**
 * Both workspaces on one virtual volume: a root manifest naming the package
 * plus the marker `ConfigLive`'s workspace-root resolver looks for.
 */
const platform = Layer.mergeAll(
	MemoryFileSystem.layerWith({
		[`${APP_A}/pnpm-workspace.yaml`]: "packages: []\n",
		[`${APP_A}/package.json`]: JSON.stringify({ name: "app-a" }),
		[`${APP_B}/pnpm-workspace.yaml`]: "packages: []\n",
		[`${APP_B}/package.json`]: JSON.stringify({ name: "app-b" }),
	}),
	Path.layer,
);

/**
 * One layer, two workspaces. `listPackagesIn` answers per directory — the
 * whole point of the per-root surface — so a single long-lived host resolves
 * identity for whichever project a call names, rather than reporting the root
 * the layer happened to be built against.
 */
const discovery = WorkspaceDiscovery.layerTest({
	listPackagesIn: (directory: string) =>
		directory === APP_A
			? Effect.succeed([rootOf("app-a", APP_A)])
			: directory === APP_B
				? Effect.succeed([rootOf("app-b", APP_B)])
				: Effect.fail(new WorkspaceRootNotFoundError({ searchPath: directory, markers: [] })),
});

/**
 * The layer is bound to `APP_A` — its config file resolver and, before the
 * per-root migration, its package discovery. A call naming `APP_B` therefore
 * only answers correctly if discovery is anchored per call.
 */
const live = ProjectIdentityLive.pipe(
	Layer.provide(
		Layer.mergeAll(platform, discovery, noGitRemoteSpawner, ConfigLive(APP_A).pipe(Layer.provide(platform))),
	),
);

const resolveIn = (workspaceRoot: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve(workspaceRoot);
		}).pipe(Effect.provide(live)),
	);

describe("ProjectIdentityLive", () => {
	it("anchors package discovery at the workspaceRoot it is called with", async () => {
		const a = await resolveIn(APP_A);
		const b = await resolveIn(APP_B);
		expect([a.projectKey, b.projectKey]).toEqual(["app-a", "app-b"]);
		expect(a.source).toBe("package-name");
	});
});
