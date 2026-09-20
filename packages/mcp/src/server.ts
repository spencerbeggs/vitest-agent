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

/** One-line human summary agents see on `serverInfo.description`. */
const DESCRIPTION = "vitest-agent MCP server: test results, coverage, history and TDD lifecycle for LLM coding agents.";

/**
 * The agent-facing orientation every client receives: in the `initialize`
 * result on the stateful protocols and in the `server/discover` result on
 * `2026-07-28`. Says what the server is for, which tool to reach for first,
 * and how to read a result; the one-line human summary stays on
 * `serverInfo.description`.
 *
 * @public
 */
export const SERVER_INSTRUCTIONS = [
	"vitest-agent serves the test landscape of one Vitest project to LLM coding agents: run results, failure detail and history, coverage, flakiness, and the TDD lifecycle (tasks, goals, behaviors, phase transitions, hypotheses, notes).",
	"Call the help tool first for the full tool reference; triage_brief orients on the current landscape; run_tests executes Vitest and persists the run so every query tool reads it back.",
	"Every input is strict at every object level: an unknown key is rejected with a message naming the unrecognized key(s) and the accepted params, so fix the call rather than retrying it.",
	"Every successful result carries the typed object in structuredContent and a text rendering (markdown where the tool renders one, otherwise the same JSON) in content[0].text; read structuredContent when you need fields.",
	"An expected domain error is NOT an isError result: it is a normal result whose structuredContent has ok: false and an error object. tdd_goal and tdd_behavior put _tag, the failing ids and a remediation naming the tool to call next in that object; register_agent puts a code and a message in it, plus existingAgentId or expectedPrefix when the code calls for one.",
	"An isError result means the call itself failed: invalid params (bare text in content[0].text, no structuredContent) or an unexpected crash inside the tool (structuredContent is an UnexpectedToolError envelope with ok: false and a remediation). Read the message and fix the call.",
].join("\n");

/**
 * The server layer: every tool registered under the strict contract, plus
 * the six framing prompts, over `McpServer.layerStdio`.
 *
 * `protocols` order is load-bearing (rc.116 `unstable/ai/internal/mcpRuntime.ts`):
 * a request carrying `_meta["io.modelcontextprotocol/protocolVersion"]`
 * routes to that adapter, an `initialize` matches the STATEFUL adapters
 * only, and anything else with no session falls to `protocols[0]`. The
 * stateless `2026-07-28` adapter (SEP-2575: no handshake, no session,
 * `server/discover` instead of `initialize`) is listed first, then the two
 * newest stateful ones — every shipping client (Claude Code's default stdio
 * session, Copilot, Cursor, the Inspector) still opens with `initialize`,
 * which a server offering ONLY `2026-07-28` answers with
 * `METHOD_NOT_FOUND`. At most one stateless adapter is allowed; a second
 * fails the layer with `Cause.IllegalArgumentError`, which is why the
 * error channel is `orDie`d: `protocols` is a static literal, so a failure
 * there is an implementer-time defect.
 *
 * @param options - the advertised server version
 * @public
 */
export const ServerLayer = (
	options: ServerLayerOptions,
): Layer.Layer<never, never, PlatformServices | McpSession | DataReader | DataStore | ProjectDiscovery> =>
	Layer.mergeAll(registerStrictToolkit(Kit).pipe(Layer.provide(ToolsLayer)), PromptsLayer).pipe(
		Layer.provide(
			McpServer.layerStdio({
				name: "vitest-agent",
				version: options.version,
				description: DESCRIPTION,
				instructions: SERVER_INSTRUCTIONS,
				protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
			}),
		),
		// Effect's default logger writes to stdout unless this reference is
		// set — and stdout is the JSON-RPC wire. Every tool defect is logged
		// (`registerStrictToolkit`) and the stdio protocol logs stdin errors,
		// so this is mandatory, not cosmetic. The bin may provide it again.
		Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
		Layer.orDie,
	);
