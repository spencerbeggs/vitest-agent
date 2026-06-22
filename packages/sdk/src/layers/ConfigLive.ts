import type { FileSystem } from "@effect/platform";
import { ConfigFile, FirstMatch, GitRoot, TomlCodec, UpwardWalk, WorkspaceRoot } from "config-file-effect";
import type { Layer } from "effect";
import { VitestAgentConfig } from "../schemas/Config.js";
import type { VitestAgentConfigFileService } from "../services/Config.js";
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
 * The first found file wins (`FirstMatch` strategy). If no file is present,
 * downstream callers use `loadOrDefault(new VitestAgentConfig({}))`
 * to get an empty config.
 *
 * @param projectDir - Absolute path inside the user's workspace. Resolvers
 *   anchor here rather than `process.cwd()` so the plugin-spawned MCP server
 *   sees the right config even when invoked from elsewhere.
 * @public
 */
export const ConfigLive = (
	projectDir: string,
): Layer.Layer<VitestAgentConfigFileService, never, FileSystem.FileSystem> =>
	ConfigFile.Live({
		tag: VitestAgentConfigFile,
		schema: VitestAgentConfig,
		codec: TomlCodec,
		strategy: FirstMatch,
		resolvers: [
			WorkspaceRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
			GitRoot({ filename: CONFIG_FILENAME, cwd: projectDir }),
			UpwardWalk({ filename: CONFIG_FILENAME, cwd: projectDir }),
		],
	});
