import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceDiscovery, WorkspacePackage } from "workspaces-effect";
import { AppDirs } from "xdg-effect";
import { VitestAgentConfig } from "../src/schemas/Config.js";
import type { VitestAgentConfigFileService } from "../src/services/Config.js";
import { VitestAgentConfigFile } from "../src/services/Config.js";
import { resolveDataPath } from "../src/utils/resolve-data-path.js";

let dataRoot: string;

beforeEach(() => {
	dataRoot = mkdtempSync(join(tmpdir(), "vitest-agent-data-"));
});

afterEach(() => {
	rmSync(dataRoot, { recursive: true, force: true });
});

const fakeAppDirs = (root: string) =>
	Layer.succeed(
		AppDirs,
		AppDirs.of({
			config: Effect.succeed(`${root}/config`),
			data: Effect.succeed(root),
			cache: Effect.succeed(`${root}/cache`),
			state: Effect.succeed(`${root}/state`),
			runtime: Effect.succeed(Option.none()),
			ensureConfig: Effect.succeed(`${root}/config`),
			ensureData: Effect.succeed(root),
			ensureCache: Effect.succeed(`${root}/cache`),
			ensureState: Effect.succeed(`${root}/state`),
			resolveAll: Effect.die(new Error("resolveAll stub: not configured")),
			ensure: Effect.die(new Error("ensure stub: not configured")),
		}),
	);

const fakeConfigFile = (config: VitestAgentConfig) => {
	const service: VitestAgentConfigFileService = {
		load: Effect.succeed(config),
		loadFrom: () => Effect.succeed(config),
		discover: Effect.succeed([]),
		write: () => Effect.die(new Error("write not used in tests")),
		loadOrDefault: () => Effect.succeed(config),
		save: () => Effect.die(new Error("save not used in tests")),
		update: () => Effect.die(new Error("update not used in tests")),
		validate: () => Effect.succeed(config),
	};
	return Layer.succeed(VitestAgentConfigFile, service);
};

const fakeDiscovery = (rootName: string | null) =>
	Layer.succeed(
		WorkspaceDiscovery,
		WorkspaceDiscovery.of({
			listPackages: () =>
				Effect.succeed(
					rootName
						? [
								new WorkspacePackage({
									name: rootName,
									version: "0.0.0",
									path: "/repo",
									packageJsonPath: "/repo/package.json",
									relativePath: ".",
								}),
							]
						: [],
				),
			getPackage: () => Effect.die(new Error("getPackage not used in tests")),
			importerMap: () => Effect.succeed(new Map()),
		}),
	);

const run = (
	projectDir: string,
	options: { cacheDir?: string },
	config: VitestAgentConfig,
	rootName: string | null = "my-app",
) =>
	Effect.runPromise(
		resolveDataPath(projectDir, options).pipe(
			Effect.provide(fakeAppDirs(dataRoot)),
			Effect.provide(fakeConfigFile(config)),
			Effect.provide(fakeDiscovery(rootName)),
		) as Effect.Effect<string, unknown, never>,
	);

describe("resolveDataPath", () => {
	it("uses programmatic options.cacheDir over everything else", async () => {
		const override = mkdtempSync(join(tmpdir(), "vitest-agent-override-"));
		const result = await run(
			"/repo",
			{ cacheDir: override },
			new VitestAgentConfig({ cacheDir: "/should-not-win", projectKey: "ignored" }),
		);
		expect(result).toBe(join(override, "data.db"));
		rmSync(override, { recursive: true, force: true });
	});

	it("falls back to config file cacheDir when no programmatic override", async () => {
		const override = mkdtempSync(join(tmpdir(), "vitest-agent-config-cache-"));
		const result = await run("/repo", {}, new VitestAgentConfig({ cacheDir: override, projectKey: "ignored" }));
		expect(result).toBe(join(override, "data.db"));
		rmSync(override, { recursive: true, force: true });
	});

	it("uses config file projectKey under XDG data when no cacheDir", async () => {
		const result = await run(
			"/repo",
			{},
			new VitestAgentConfig({ projectKey: "my-app-personal" }),
			"workspace-name-ignored",
		);
		expect(result).toBe(join(dataRoot, "my-app-personal", "data.db"));
	});

	it("normalizes a config file projectKey before using it", async () => {
		const result = await run("/repo", {}, new VitestAgentConfig({ projectKey: "@org/custom" }));
		expect(result).toBe(join(dataRoot, "@org__custom", "data.db"));
	});

	it("falls back to workspace name under XDG data when no overrides", async () => {
		const result = await run("/repo", {}, new VitestAgentConfig({}), "@org/pkg");
		expect(result).toBe(join(dataRoot, "@org__pkg", "data.db"));
	});

	it("ensures the parent directory exists for the database", async () => {
		const result = await run("/repo", {}, new VitestAgentConfig({}), "my-app");
		expect(existsSync(dirname(result))).toBe(true);
	});

	it("returns the same path for two projectDirs sharing a workspace name", async () => {
		const a = await run("/code/my-app", {}, new VitestAgentConfig({}), "my-app");
		const b = await run("/worktrees/my-app-branch", {}, new VitestAgentConfig({}), "my-app");
		expect(a).toBe(b);
	});

	it("fails loudly when no overrides and no workspace name", async () => {
		await expect(run("/repo", {}, new VitestAgentConfig({}), null)).rejects.toThrow(/Workspace root not found/);
	});
});
