import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDirs } from "xdg-effect";
import { VitestAgentConfig } from "../src/schemas/Config.js";
import type { VitestAgentConfigFileService } from "../src/services/Config.js";
import { VitestAgentConfigFile } from "../src/services/Config.js";
import { resolveDataPath } from "../src/utils/resolve-data-path.js";

let dataRoot: string;
const tempCwds: string[] = [];

const seedCwd = (pkg: { name?: string; repository?: unknown } | null): string => {
	const dir = mkdtempSync(join(tmpdir(), "vitest-agent-cwd-"));
	tempCwds.push(dir);
	if (pkg !== null) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
	return dir;
};

beforeEach(() => {
	dataRoot = mkdtempSync(join(tmpdir(), "vitest-agent-data-"));
});

afterEach(() => {
	rmSync(dataRoot, { recursive: true, force: true });
	while (tempCwds.length > 0) {
		const dir = tempCwds.pop();
		if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
	}
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

const run = (projectDir: string, options: { cacheDir?: string }, config: VitestAgentConfig) =>
	Effect.runPromise(
		resolveDataPath(projectDir, options).pipe(
			Effect.provide(fakeAppDirs(dataRoot)),
			Effect.provide(fakeConfigFile(config)),
		) as Effect.Effect<string, unknown, never>,
	);

describe("resolveDataPath", () => {
	it("uses programmatic options.cacheDir over everything else", async () => {
		const override = mkdtempSync(join(tmpdir(), "vitest-agent-override-"));
		const cwd = seedCwd({ name: "my-app" });
		const result = await run(
			cwd,
			{ cacheDir: override },
			new VitestAgentConfig({ cacheDir: "/should-not-win", projectKey: "ignored" }),
		);
		expect(result).toBe(join(override, "data.db"));
		rmSync(override, { recursive: true, force: true });
	});

	it("falls back to config file cacheDir when no programmatic override", async () => {
		const override = mkdtempSync(join(tmpdir(), "vitest-agent-config-cache-"));
		const cwd = seedCwd({ name: "my-app" });
		const result = await run(cwd, {}, new VitestAgentConfig({ cacheDir: override, projectKey: "ignored" }));
		expect(result).toBe(join(override, "data.db"));
		rmSync(override, { recursive: true, force: true });
	});

	it("uses config file projectKey under XDG data when no cacheDir", async () => {
		const cwd = seedCwd({ name: "workspace-name-ignored" });
		const result = await run(cwd, {}, new VitestAgentConfig({ projectKey: "my-app-personal" }));
		expect(result).toBe(join(dataRoot, "my-app-personal", "data.db"));
	});

	it("normalizes a config file projectKey before using it", async () => {
		const cwd = seedCwd({ name: "anything" });
		const result = await run(cwd, {}, new VitestAgentConfig({ projectKey: "@org/custom" }));
		expect(result).toBe(join(dataRoot, "@org__custom", "data.db"));
	});

	it("uses repository.url over package.json#name when both are present", async () => {
		const cwd = seedCwd({ name: "local-name", repository: "git+https://github.com/foo/bar.git" });
		const result = await run(cwd, {}, new VitestAgentConfig({}));
		expect(result).toBe(join(dataRoot, "github.com__foo__bar", "data.db"));
	});

	it("falls back to normalized package.json name when no repository.url", async () => {
		const cwd = seedCwd({ name: "@org/pkg" });
		const result = await run(cwd, {}, new VitestAgentConfig({}));
		expect(result).toBe(join(dataRoot, "@org__pkg", "data.db"));
	});

	it("ensures the parent directory exists for the database", async () => {
		const cwd = seedCwd({ name: "my-app" });
		const result = await run(cwd, {}, new VitestAgentConfig({}));
		expect(existsSync(dirname(result))).toBe(true);
	});

	it("returns the same path for two projectDirs sharing a repository.url", async () => {
		const a = await run(
			seedCwd({ name: "my-app", repository: { url: "git@github.com:org/my-app.git" } }),
			{},
			new VitestAgentConfig({}),
		);
		const b = await run(
			seedCwd({ name: "my-app", repository: "https://github.com/org/my-app.git" }),
			{},
			new VitestAgentConfig({}),
		);
		expect(a).toBe(b);
	});

	it("falls back to a non-empty key (cwd basename) when no package.json is reachable", async () => {
		const cwd = seedCwd(null);
		const result = await run(cwd, {}, new VitestAgentConfig({}));
		expect(result.endsWith(`${cwd.split("/").pop()}/data.db`)).toBe(true);
	});
});
