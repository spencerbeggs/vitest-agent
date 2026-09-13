/**
 * The Effect-native tool surface: one `Toolkit` gathering every tool, the
 * handler record, and the handlers layer `registerStrictToolkit` requires.
 *
 * @packageDocumentation
 */

import { Toolkit } from "effect/unstable/ai";
import { handleHelp, helpTool } from "./tools/help.js";
import { handlePing, pingTool } from "./tools/ping.js";

/**
 * Every tool the server registers.
 *
 * @public
 */
export const Kit = Toolkit.make(pingTool, helpTool);

/**
 * The handler for each tool in {@link Kit}, keyed by tool name.
 *
 * @public
 */
export const toolHandlers = {
	ping: handlePing,
	help: handleHelp,
} satisfies Toolkit.HandlersFrom<typeof Kit.tools>;

/**
 * The handlers layer: provides `Tool.HandlersFor<typeof Kit.tools>`.
 *
 * @public
 */
export const ToolsLayer = Kit.toLayer(toolHandlers);
