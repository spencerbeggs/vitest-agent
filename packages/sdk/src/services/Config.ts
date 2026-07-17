import type { ConfigFileShape } from "@effected/config-file";
import { ConfigFile } from "@effected/config-file";
import type { VitestAgentConfig } from "../schemas/Config.js";

/**
 * Service shape that `ConfigLive(projectDir)` provides to downstream
 * consumers. Re-exported so callers can spell out the concrete service
 * type without referencing the `ConfigFileShape<A>` generic directly.
 * @public
 */
export type VitestAgentConfigFileService = ConfigFileShape<VitestAgentConfig>;

/**
 * Typed service class (Context tag) for the vitest-agent config file service.
 *
 * Both runtime packages (reporter, MCP) yield this tag to access the loaded
 * `VitestAgentConfig`. The live layer is built per `projectDir` via
 * `ConfigLive(projectDir)`.
 * @public
 */
export class VitestAgentConfigFile extends ConfigFile.Service<VitestAgentConfigFile, VitestAgentConfig>()(
	"vitest-agent/Config",
) {}
