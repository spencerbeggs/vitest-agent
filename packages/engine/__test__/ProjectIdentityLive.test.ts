import { MemoryFileSystem } from "@effected/memfs";
import {
	WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	WorkspacePackage,
	WorkspaceRootNotFoundError,
} from "@effected/workspaces";
import { ProjectIdentityNotResolvableError, ProjectIdentitySourceError } from "@vitest-agent/sdk";
import { Effect, Layer, Path, PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { describe, expect, it } from "vitest";
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

	it("propagates ProjectIdentitySourceError when configured to fail with one", async () => {
		const error = new ProjectIdentitySourceError({
			source: "toml",
			path: "/whatever/vitest-agent.config.toml",
			detail: "unterminated string",
			cause: new Error("unterminated string"),
		});
		const program = Effect.gen(function* () {
			const id = yield* ProjectIdentity;
			return yield* id.resolve("/whatever");
		}).pipe(Effect.provide(ProjectIdentityTest(error)), Effect.flip);

		const failure = await Effect.runPromise(program);
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		expect(failure.message).toContain("vitest-agent.config.toml at /whatever/vitest-agent.config.toml");
		expect(failure.message).toContain("unterminated string");
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

/**
 * One workspace per scenario, each on its own volume. The volume's seed is
 * the only thing that differs between cases, so every assertion below is
 * about how `ProjectIdentityLive` reads the files, not about how they were
 * arranged. `faults` injects the filesystem failure a seed cannot express.
 */
const APP = "/code/app";

const scenario = (
	seed: Record<string, string>,
	options: {
		readonly faults?: NonNullable<Parameters<typeof MemoryFileSystem.layerWith>[1]>["faults"];
		readonly discovery?: Layer.Layer<WorkspaceDiscovery>;
	} = {},
) => {
	const fs = Layer.mergeAll(
		MemoryFileSystem.layerWith(seed, options.faults === undefined ? {} : { faults: options.faults }),
		Path.layer,
	);
	const disco =
		options.discovery ??
		WorkspaceDiscovery.layerTest({
			listPackagesIn: (directory: string) =>
				directory === APP
					? Effect.succeed([rootOf("app", APP)])
					: Effect.fail(new WorkspaceRootNotFoundError({ searchPath: directory, markers: [] })),
		});
	const layer = ProjectIdentityLive.pipe(
		Layer.provide(Layer.mergeAll(fs, disco, noGitRemoteSpawner, ConfigLive(APP).pipe(Layer.provide(fs)))),
	);
	return Effect.gen(function* () {
		const id = yield* ProjectIdentity;
		return yield* id.resolve(APP);
	}).pipe(Effect.provide(layer));
};

const workspace = (extra: Record<string, string> = {}) => ({
	[`${APP}/pnpm-workspace.yaml`]: "packages: []\n",
	[`${APP}/package.json`]: JSON.stringify({ name: "app" }),
	...extra,
});

const failureOf = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(program));

describe("ProjectIdentityLive: absence falls through, breakage fails typed (#321)", () => {
	it("no vitest-agent.config.toml anywhere: the default identity from package.json name", async () => {
		const identity = await Effect.runPromise(scenario(workspace()));
		expect(identity).toEqual({ projectKey: "app", canonicalForm: "app", source: "package-name" });
	});

	it("a well-formed vitest-agent.config.toml with projectKey wins over package.json name", async () => {
		const identity = await Effect.runPromise(
			scenario(workspace({ [`${APP}/vitest-agent.config.toml`]: 'projectKey = "from-toml"\n' })),
		);
		expect(identity.source).toBe("toml");
		expect(identity.projectKey).toBe("from-toml");
	});

	it("malformed TOML fails with ProjectIdentitySourceError(toml) instead of defaulting", async () => {
		const failure = await failureOf(
			scenario(workspace({ [`${APP}/vitest-agent.config.toml`]: 'projectKey = "unterminated\n' })),
		);
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		if (failure._tag !== "ProjectIdentitySourceError") throw new Error("unreachable");
		expect(failure.source).toBe("toml");
		expect(failure.path).toBe(`${APP}/vitest-agent.config.toml`);
		expect(failure.message).toContain("vitest-agent.config.toml");
		expect(failure.cause).toMatchObject({ _tag: "ConfigCodecError" });
	});

	it("TOML the schema rejects fails with ProjectIdentitySourceError(toml) carrying the validation issue", async () => {
		const failure = await failureOf(scenario(workspace({ [`${APP}/vitest-agent.config.toml`]: "projectKey = 42\n" })));
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		if (failure._tag !== "ProjectIdentitySourceError") throw new Error("unreachable");
		expect(failure.source).toBe("toml");
		expect(failure.path).toBe(`${APP}/vitest-agent.config.toml`);
		expect(failure.cause).toMatchObject({ _tag: "ConfigValidationError" });
	});

	it("an unreadable root package.json fails with ProjectIdentitySourceError(package-json)", async () => {
		const denied = PlatformError.systemError({
			_tag: "PermissionDenied",
			module: "FileSystem",
			method: "readFileString",
			pathOrDescriptor: `${APP}/package.json`,
		});
		const failure = await failureOf(
			scenario(workspace(), {
				faults: {
					readFileString: (path) => (path === `${APP}/package.json` ? Effect.fail(denied) : undefined),
				},
			}),
		);
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		if (failure._tag !== "ProjectIdentitySourceError") throw new Error("unreachable");
		expect(failure.source).toBe("package-json");
		expect(failure.path).toBe(`${APP}/package.json`);
		expect(failure.cause).toBe(denied);
	});

	it("a root package.json that is not JSON fails with ProjectIdentitySourceError(package-json)", async () => {
		const failure = await failureOf(
			scenario({ [`${APP}/pnpm-workspace.yaml`]: "packages: []\n", [`${APP}/package.json`]: "{ not json" }),
		);
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		if (failure._tag !== "ProjectIdentitySourceError") throw new Error("unreachable");
		expect(failure.source).toBe("package-json");
		expect(failure.cause).toBeInstanceOf(SyntaxError);
	});

	it("a root package.json discovery named but the volume lacks is an absent source, not a failure", async () => {
		// Discovery says there is a root; the volume has no package.json at all.
		// NotFound is the one filesystem answer that still means "no repository
		// URL" — the name still arrives through discovery.
		const identity = await Effect.runPromise(scenario({ [`${APP}/pnpm-workspace.yaml`]: "packages: []\n" }));
		expect(identity.source).toBe("package-name");
	});

	it("a directory in no workspace at all still fails with ProjectIdentityNotResolvableError", async () => {
		const failure = await failureOf(
			scenario(
				{},
				{
					discovery: WorkspaceDiscovery.layerTest({
						listPackagesIn: (directory: string) =>
							Effect.fail(new WorkspaceRootNotFoundError({ searchPath: directory, markers: ["package.json"] })),
					}),
				},
			),
		);
		expect(failure._tag).toBe("ProjectIdentityNotResolvableError");
	});

	it("a workspace whose manifests discovery rejects fails with ProjectIdentitySourceError(workspace)", async () => {
		const failure = await failureOf(
			scenario(workspace(), {
				discovery: WorkspaceDiscovery.layerTest({
					listPackagesIn: () =>
						Effect.fail(
							new WorkspaceDiscoveryError({
								root: APP,
								path: `${APP}/packages/a/package.json`,
								kind: "invalidJson",
								cause: new SyntaxError("Unexpected token"),
							}),
						),
				}),
			}),
		);
		expect(failure._tag).toBe("ProjectIdentitySourceError");
		if (failure._tag !== "ProjectIdentitySourceError") throw new Error("unreachable");
		expect(failure.source).toBe("workspace");
		expect(failure.path).toBe(`${APP}/packages/a/package.json`);
	});
});
