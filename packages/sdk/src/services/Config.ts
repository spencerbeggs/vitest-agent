import type { ConfigFileService } from "config-file-effect";
import { ConfigFile } from "config-file-effect";
import type { VitestAgentConfig } from "../schemas/Config.js";

/**
 * Service shape that `ConfigLive(projectDir)` provides to downstream
 * consumers. Re-exported so callers can spell out the concrete service
 * type without referencing the `ConfigFileService<A>` generic directly.
 * @public
 */
export type VitestAgentConfigFileService = ConfigFileService<VitestAgentConfig>;

/**
 * Typed `Context.Tag` for the vitest-agent config file service.
 *
 * Both runtime packages (reporter, MCP) yield this tag to access the loaded
 * `VitestAgentConfig`. The live layer is built per `projectDir` via
 * `ConfigLive(projectDir)`.
 * @public
 */
export const VitestAgentConfigFile = ConfigFile.Tag<VitestAgentConfig>("vitest-agent/Config");
