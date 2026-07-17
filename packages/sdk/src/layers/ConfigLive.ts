import { ConfigFile, ConfigResolver, MergeStrategy, TomlCodec } from "@effected/config-file";
import type { FileSystem, Layer, Path } from "effect";
import { VitestAgentConfig } from "../schemas/Config.js";
import { VitestAgentConfigFile } from "../services/Config.js";

const CONFIG_FILENAME = "vitest-agent.config.toml";

/**
 * Build the live `ConfigFile` layer for a given project directory.
 *
 * Resolves the optional `vitest-agent.config.toml` from (in order):
 *
 * 1. The workspace root (when `projectDir` is inside a pnpm/npm/yarn workspace).
 * 2. The git repository root (when `projectDir` is inside a git repo).
 * 3. Walking upward from `projectDir`.
 *
 * The first found file wins (`MergeStrategy.firstMatch()`). If no file is
 * present, downstream callers use `loadOrDefault(new VitestAgentConfig({}))`
 * to get an empty config.
 *
 * @param projectDir - Absolute path inside the user's workspace. Resolvers
 *   anchor here rather than `process.cwd()` so the plugin-spawned MCP server
 *   sees the right config even when invoked from elsewhere.
 * @public
 */
export const ConfigLive = (
	projectDir: string,
): Layer.Layer<VitestAgentConfigFile, never, FileSystem.FileSystem | Path.Path> =>
	ConfigFile.layer(VitestAgentConfigFile, {
		schema: VitestAgentConfig,
		codec: TomlCodec,
		strategy: MergeStrategy.firstMatch(),
		resolvers: [
			ConfigResolver.workspaceRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
			ConfigResolver.gitRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
			ConfigResolver.upwardWalk({ filename: CONFIG_FILENAME, cwd: projectDir }),
		],
	});
