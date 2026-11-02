// The assembled Effect-native MCP server over stdio.

import { McpStdio, McpToolkit } from "@effected/mcp-kit";
import type { DataReader, DataStore, ProjectDiscovery } from "@vitest-agent/engine";
import type { Scope, Stdio } from "effect";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/ai";
import { PromptsLayer } from "./prompts/layer.js";
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
	"Every successful result carries the typed object in structuredContent; read structuredContent for every field.",
	"An expected domain error is NOT an isError result: it is a normal result whose structuredContent has ok: false and an error object. tdd_goal and tdd_behavior put _tag, a one-sentence message, the failing ids and a remediation naming the tool to call next in that object; register_agent puts a code and a message in it, plus existingAgentId or expectedPrefix when the code calls for one.",
	"An isError result means the call itself failed and carries no structuredContent. Its text either names what to fix (invalid params, or a refused call such as an unknown id, often ending 'Try <tool>.' with the tool to call next) or is a generic internal-error message (the server logged the detail). Fix the call, or report the internal failure rather than retrying it unchanged.",
].join("\n");

/**
 * Meets every registration's request-level dependencies. A tool's declared
 * `dependencies` (and a prompt's services) are per-request
 * `McpServer.McpRequest<"Requires", S>` requirements that only MCP middleware
 * discharges; every one of ours is fixed for the life of the server, so the
 * middleware reads them once when it is built and provides the same context
 * to every request. `McpServer` itself is read from the transport, for
 * `tdd_progress_push`'s `notifications/message` frame.
 */
const RequestServices = McpServer.middleware<{
	provides: McpSession | DataReader | DataStore | McpServer.McpServer;
}>()(
	Effect.gen(function* () {
		const context = yield* Effect.context<McpSession | DataReader | DataStore | McpServer.McpServer>();
		return (effect) => Effect.provideContext(effect, context);
	}),
);

/**
 * The server layer: every tool registered through `McpToolkit.layer` (strict
 * by default, every unknown key named in one `InvalidParams`) plus the six
 * framing prompts, passed to `McpStdio.layer` as its `registrations` so they
 * are built before the first request, with build-time logs on stderr.
 *
 * `McpStdio.layer` serves `McpStdio.protocols` — the stateless `2026-07-28`
 * adapter first, then `2025-11-25` and `2025-06-18` — provides
 * `LogToStderr` (stdout is the JSON-RPC wire) to everything it provides, and
 * answers a malformed stdin line itself instead of wedging core's decoder.
 * Its output is what `McpStdio.layer` returns: the `McpServer` it serves
 * and the `Scope` request marker the transport discharges.
 *
 * @param options - the advertised server version
 * @public
 */
export const ServerLayer = (
	options: ServerLayerOptions,
): Layer.Layer<
	McpServer.McpServer | McpServer.McpRequest<"Requires", Scope.Scope>,
	never,
	PlatformServices | McpSession | DataReader | DataStore | ProjectDiscovery
> =>
	McpStdio.layer({
		name: "vitest-agent",
		version: options.version,
		description: DESCRIPTION,
		instructions: SERVER_INSTRUCTIONS,
		registrations: Layer.mergeAll(McpToolkit.layer(Kit).pipe(Layer.provide(ToolsLayer)), PromptsLayer).pipe(
			Layer.provide(RequestServices.layer),
		),
	});
