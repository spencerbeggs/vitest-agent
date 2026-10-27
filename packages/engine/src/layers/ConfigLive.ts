import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { TomlCodec } from "@effected/config-file/toml";
import { Git } from "@effected/git";
import { VitestAgentConfig } from "@vitest-agent/sdk";
import type { FileSystem, Path } from "effect";
import { Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { VitestAgentConfigFile } from "../services/Config.js";

const CONFIG_FILENAME = "vitest-agent.config.toml";

/**
 * The repository root git answers for `projectDir`, used as the upward
 * walk's ceiling: the `Git` service when one is in context, else `Git.layer`
 * over a `ChildProcessSpawner` when one is (every front end provides
 * `NodeServices.layer`), else no answer. Neither is a requirement: outside
 * a repository, with no `git` on `PATH`, or with no spawner at all, the walk
 * runs to the filesystem root as it always did.
 */
const repoRootCeiling = (projectDir: string): Effect.Effect<string | undefined> =>
	Effect.gen(function* () {
		const ask = (git: (typeof Git)["Service"]) => git.repoRoot(projectDir).pipe(Effect.orElseSucceed(() => undefined));
		const git = yield* Effect.serviceOption(Git);
		if (Option.isSome(git)) return yield* ask(git.value);
		const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
		if (Option.isNone(spawner)) return undefined;
		return yield* Effect.flatMap(Git, ask).pipe(
			Effect.provide(Git.layer),
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner.value),
		);
	});

/**
 * Build the live `ConfigFile` layer for a given project directory.
 *
 * Resolves the optional `vitest-agent.config.toml` from (in order):
 *
 * 1. The workspace root (when `projectDir` is inside a pnpm/npm/yarn workspace).
 * 2. The git repository root (when `projectDir` is inside a git repo).
 * 3. Walking upward from `projectDir`, stopping at the git repository root
 *    (inclusive, compared physically) so a config file above the repository
 *    is never picked up. Outside a repository the walk runs to the
 *    filesystem root.
 *
 * The first found file wins (`MergeStrategy.firstMatch()`). If no file is
 * present, downstream callers use `loadOrDefault(new VitestAgentConfig({}))`
 * to get an empty config.
 *
 * The repository root comes from `git rev-parse --show-toplevel` through
 * `@effected/git`, using a `Git` or `ChildProcessSpawner` service if the
 * context has one; neither is required (see `repoRootCeiling`).
 *
 * @param projectDir - Absolute path inside the user's workspace. Resolvers
 *   anchor here rather than `process.cwd()` so the plugin-spawned MCP server
 *   sees the right config even when invoked from elsewhere.
 * @public
 */
export const ConfigLive = (
	projectDir: string,
): Layer.Layer<VitestAgentConfigFile, never, FileSystem.FileSystem | Path.Path> =>
	Layer.unwrap(
		Effect.map(repoRootCeiling(projectDir), (ceiling) =>
			ConfigFile.layer(VitestAgentConfigFile, {
				schema: VitestAgentConfig,
				codec: TomlCodec,
				strategy: MergeStrategy.firstMatch(),
				resolvers: [
					ConfigResolver.workspaceRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
					ConfigResolver.gitRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
					ConfigResolver.upwardWalk({
						filename: CONFIG_FILENAME,
						cwd: projectDir,
						...(ceiling !== undefined && { ceiling }),
					}),
				],
			}),
		),
	);
