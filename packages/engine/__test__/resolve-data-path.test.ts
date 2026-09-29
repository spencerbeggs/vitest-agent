import { join } from "node:path";
import type { MemoryFileSystemSeed, MemoryFileSystemVolume } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { AppDirs, ResolvedAppDirs } from "@effected/xdg";
import { VitestAgentConfig } from "@vitest-agent/sdk";
import { Effect, FileSystem, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { VitestAgentConfigFileService } from "../src/services/Config.js";
import { VitestAgentConfigFile } from "../src/services/Config.js";
import { resolveDataPath } from "../src/utils/resolve-data-path.js";

/**
 * Everything lives on one in-memory volume: the XDG data root and every
 * workspace. No `package.json` sits above `/work`, so the cwd-basename
 * fallback is deterministic rather than hostage to the host's tmpdir
 * ancestry.
 */
const dataRoot = "/xdg/data/vitest-agent";

const cwdPath = (name: string) => `/work/${name}`;

/** Seed entries for one workspace dir, with a `package.json` unless `pkg` is null. */
const workspace = (name: string, pkg: { name?: string; repository?: unknown } | null): MemoryFileSystemSeed =>
	pkg === null
		? { [cwdPath(name)]: MemoryFileSystem.directory() }
		: { [`${cwdPath(name)}/package.json`]: JSON.stringify(pkg) };

const fakeAppDirs = (root: string) =>
	Layer.succeed(
		AppDirs,
		AppDirs.of({
			namespace: "vitest-agent",
			dirs: new ResolvedAppDirs({
				config: `${root}/config`,
				data: root,
				cache: `${root}/cache`,
				state: `${root}/state`,
				configSearchPath: [`${root}/config`],
				dataSearchPath: [root],
			}),
			ensureConfig: Effect.succeed(`${root}/config`),
			ensureData: Effect.succeed(root),
			ensureCache: Effect.succeed(`${root}/cache`),
			ensureState: Effect.succeed(`${root}/state`),
			ensureRuntime: Effect.succeed(Option.none()),
			ensure: Effect.die(new Error("ensure stub: not configured")),
		}),
	);

const fakeConfigFile = (config: VitestAgentConfig) => {
	const service: VitestAgentConfigFileService = {
		load: Effect.succeed(config),
		loadFrom: () => Effect.succeed(config),
		discover: Effect.succeed([]),
		write: () => Effect.die(new Error("write not used in tests")),
		encode: () => Effect.die(new Error("encode not used in tests")),
		loadOrDefault: () => Effect.succeed(config),
		save: () => Effect.die(new Error("save not used in tests")),
		update: () => Effect.die(new Error("update not used in tests")),
		validate: () => Effect.succeed(config),
	};
	return Layer.succeed(VitestAgentConfigFile, service);
};

const run = (
	seed: MemoryFileSystemSeed,
	projectDir: string,
	options: { cacheDir?: string },
	config: VitestAgentConfig,
): Promise<{ result: string; volume: MemoryFileSystemVolume }> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeInspectableWith(seed);
			const result = yield* resolveDataPath(projectDir, options).pipe(
				Effect.provide(fakeAppDirs(dataRoot)),
				Effect.provide(fakeConfigFile(config)),
				Effect.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
			);
			return { result, volume };
		}) as Effect.Effect<{ result: string; volume: MemoryFileSystemVolume }, unknown, never>,
	);

describe("resolveDataPath", () => {
	it("uses programmatic options.cacheDir over everything else", async () => {
		const { result, volume } = await run(
			workspace("app", { name: "my-app" }),
			cwdPath("app"),
			{ cacheDir: "/override" },
			new VitestAgentConfig({ cacheDir: "/should-not-win", projectKey: "ignored" }),
		);
		expect(result).toBe(join("/override", "data.db"));
		expect(volume.isDirectory("/override")).toBe(true);
		expect(volume.isDirectory("/should-not-win")).toBe(false);
	});

	it("falls back to config file cacheDir when no programmatic override", async () => {
		const { result, volume } = await run(
			workspace("app", { name: "my-app" }),
			cwdPath("app"),
			{},
			new VitestAgentConfig({ cacheDir: "/config-cache", projectKey: "ignored" }),
		);
		expect(result).toBe(join("/config-cache", "data.db"));
		expect(volume.isDirectory("/config-cache")).toBe(true);
	});

	it("uses config file projectKey under XDG data when no cacheDir", async () => {
		const { result } = await run(
			workspace("app", { name: "workspace-name-ignored" }),
			cwdPath("app"),
			{},
			new VitestAgentConfig({ projectKey: "my-app-personal" }),
		);
		expect(result).toBe(join(dataRoot, "my-app-personal", "data.db"));
	});

	it("normalizes a config file projectKey before using it", async () => {
		const { result } = await run(
			workspace("app", { name: "anything" }),
			cwdPath("app"),
			{},
			new VitestAgentConfig({ projectKey: "@org/custom" }),
		);
		expect(result).toBe(join(dataRoot, "@org__custom", "data.db"));
	});

	it("uses repository.url over package.json#name when both are present", async () => {
		const { result } = await run(
			workspace("app", { name: "local-name", repository: "git+https://github.com/foo/bar.git" }),
			cwdPath("app"),
			{},
			new VitestAgentConfig({}),
		);
		expect(result).toBe(join(dataRoot, "github.com__foo__bar", "data.db"));
	});

	it("falls back to normalized package.json name when no repository.url", async () => {
		const { result } = await run(workspace("app", { name: "@org/pkg" }), cwdPath("app"), {}, new VitestAgentConfig({}));
		expect(result).toBe(join(dataRoot, "@org__pkg", "data.db"));
	});

	it("ensures the parent directory exists for the database", async () => {
		const { result, volume } = await run(
			workspace("app", { name: "my-app" }),
			cwdPath("app"),
			{},
			new VitestAgentConfig({}),
		);
		expect(result).toBe(join(dataRoot, "my-app", "data.db"));
		expect(volume.isDirectory(join(dataRoot, "my-app"))).toBe(true);
		// Only the directory is ensured; the SQLite driver creates the file.
		expect(volume.has(result)).toBe(false);
	});

	it("returns the same path for two projectDirs sharing a repository.url", async () => {
		const seed = {
			...workspace("a", { name: "my-app", repository: { url: "git@github.com:org/my-app.git" } }),
			...workspace("b", { name: "my-app", repository: "https://github.com/org/my-app.git" }),
		};
		const a = await run(seed, cwdPath("a"), {}, new VitestAgentConfig({}));
		const b = await run(seed, cwdPath("b"), {}, new VitestAgentConfig({}));
		expect(a.result).toBe(join(dataRoot, "github.com__org__my-app", "data.db"));
		expect(b.result).toBe(a.result);
	});

	it("falls back to a non-empty key (cwd basename) when no package.json is reachable", async () => {
		const { result } = await run(workspace("bare-dir", null), cwdPath("bare-dir"), {}, new VitestAgentConfig({}));
		expect(result).toBe(join(dataRoot, "bare-dir", "data.db"));
	});
});
