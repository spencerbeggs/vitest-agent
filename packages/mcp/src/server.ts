// The assembled Effect-native MCP server over stdio.

import type { DataReader, DataStore, ProjectDiscovery } from "@vitest-agent/engine";
import type { Stdio } from "effect";
import { Layer, Logger } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { PromptsLayer } from "./prompts/layer.js";
import { registerStrictToolkit } from "./register-toolkit.js";
import type { McpSession } from "./session.js";
import { Kit, ToolsLayer } from "./toolkit.js";

/**
 * The platform services the stdio transport needs.
 *
 * @public
 */
export type PlatformServices = Stdio.Stdio;

/**
 * Options for {@link ServerLayer}.
 *
 * @public
 */
export interface ServerLayerOptions {
	/** The `serverInfo.version` advertised on initialize (the package version in production). */
	readonly version: string;
}

/**
 * One-line pointer agents see on `serverInfo.description`. `instructions`
 * cannot be set through `McpServer.layerStdio` at rc.115, so this is the
 * at-initialize orientation hook.
 */
const DESCRIPTION =
	"vitest-agent MCP server: test results, coverage, history and TDD lifecycle for LLM coding agents. Call the `help` tool first for the full tool reference.";

/**
 * The server layer: every tool registered under the strict contract, plus
 * the six framing prompts, over `McpServer.layerStdio`. `protocols` is newest-first because the registry
 * falls back to `protocols[0]` for a client offering an unknown version.
 *
 * @param options - the advertised server version
 * @public
 */
export const ServerLayer = (
	options: ServerLayerOptions,
): Layer.Layer<
	never,
	never,
	PlatformServices | McpSession | DataReader | DataStore | ProjectDiscovery
> =>
	Layer.mergeAll(registerStrictToolkit(Kit).pipe(Layer.provide(ToolsLayer)), PromptsLayer).pipe(
		Layer.provide(
			McpServer.layerStdio({
				name: "vitest-agent",
				version: options.version,
				description: DESCRIPTION,
				protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
			}),
		),
		// Effect's default logger writes to stdout unless this reference is
		// set — and stdout is the JSON-RPC wire. Every tool defect is logged
		// (`registerStrictToolkit`) and the stdio protocol logs stdin errors,
		// so this is mandatory, not cosmetic. The bin may provide it again.
		Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
		Layer.orDie,
	);
