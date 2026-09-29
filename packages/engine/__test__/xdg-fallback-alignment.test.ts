/**
 * Issue #422: with `XDG_DATA_HOME` unset, the reporter/MCP route
 * (`resolveDataPath` over `PathResolutionLive`) and the hook/sidecar route
 * (`resolveHookPaths`) must land in the same directory.
 *
 * Both routes read and create directories only through `FileSystem` +
 * `Path` (`AppDirs`, `ConfigLive`'s resolvers, `WorkspaceDiscovery`), so the
 * case runs on one in-memory volume — which also keeps the config-file
 * upward walk from finding a stray `vitest-agent.config.toml` above a real
 * tmpdir.
 */

import { dirname, join } from "node:path";
import { MemoryFileSystem } from "@effected/memfs";
import { ConfigProvider, Effect, FileSystem, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { PathResolutionLive } from "../src/layers/PathResolutionLive.js";
import { resolveHookPaths } from "../src/programs/hook-paths.js";
import { resolveDataPath } from "../src/utils/resolve-data-path.js";

const home = "/home/user";
const cwd = "/work/project";

describe("XDG fallback alignment", () => {
	it("should resolve resolveDataPath and resolveHookPaths to the same directory under $HOME/.local/share/vitest-agent when XDG_DATA_HOME is unset", async () => {
		// Given: HOME points at a volume dir and XDG_DATA_HOME is unset
		const env = { HOME: home };
		const { fileSystem, volume } = await Effect.runPromise(
			MemoryFileSystem.makeInspectableWith({
				[home]: MemoryFileSystem.directory(),
				[`${cwd}/package.json`]: JSON.stringify({ name: "@org/pkg" }),
			}),
		);
		const Platform = Layer.merge(Layer.succeed(FileSystem.FileSystem, fileSystem), Path.layer);
		const EnvLive = ConfigProvider.layer(ConfigProvider.fromEnvRecord(env));
		const Deps = PathResolutionLive(cwd).pipe(Layer.provide(EnvLive), Layer.provideMerge(Platform));

		// When: both routes resolve
		const dataPath = await Effect.runPromise(
			resolveDataPath(cwd).pipe(Effect.provide(Deps)) as Effect.Effect<string, unknown, never>,
		);
		const hookPaths = await Effect.runPromise(
			resolveHookPaths({ env, projectKey: "@org__pkg" }).pipe(Effect.provide(Platform)),
		);

		// Then: they agree, under the XDG spec default, and the directory exists
		const expected = join(home, ".local", "share", "vitest-agent", "@org__pkg");
		expect(dirname(dataPath)).toBe(hookPaths.projectDataDir);
		expect(dirname(dataPath)).toBe(expected);
		expect(volume.isDirectory(expected)).toBe(true);
	});
});
