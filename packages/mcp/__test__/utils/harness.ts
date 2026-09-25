/**
 * In-process stdio harness for the vitest-agent MCP server: `@effected/mcp`'s
 * `McpHarness` over the REAL `ServerLayer`, plus the one thing it cannot know
 * — the engine services the server reads, built ONCE so a `seed` (or a test,
 * via `services`) talks to the same in-memory store the tools read.
 *
 * `McpHarness` supplies the queue-backed `Stdio`, builds the server under a
 * fresh memo map, captures the server's console (`stderrSoFar` holds every log
 * line; `consoleLogSoFar` must stay empty, since `console.log` is the wire),
 * and dies a wait the moment stdout carries a line that is not JSON-RPC.
 * Every wait here is `orDie`d so a test reads plain values.
 */

import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import type { ServedTool } from "@effected/mcp/testing";
import { McpHarness as KitHarness } from "@effected/mcp/testing";
import type { DataReader, DataStore, ProjectDiscovery } from "@vitest-agent/engine";
import { ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import type { Scope } from "effect";
import { Context, Effect, Layer, Option, Stdio } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import { ServerLayer } from "../../src/server.js";
import { McpSession } from "../../src/session.js";

export interface JsonRpcMessage {
	readonly jsonrpc: "2.0";
	readonly id?: string | number | null | undefined;
	readonly method?: string | undefined;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

export type McpToolDescriptor = ServedTool;

/** The services the harness builds for the server (and hands to `seed` / `services`). */
export type HarnessServices = McpSession | DataReader | DataStore | ProjectDiscovery;

export interface McpHarness {
	/** The built service context: run a seeding effect against the SAME in-memory store the server reads. */
	readonly services: Context.Context<HarnessServices>;
	/** The underlying `@effected/mcp` harness, for `startRequest` / `awaitOutboundMethod` / `sendRaw`. */
	readonly kit: KitHarness;
	/**
	 * Open the session: `initialize` + `notifications/initialized` on a stateful
	 * revision, `server/discover` on the stateless one. A `protocolVersion`
	 * other than the harness's own is offered verbatim in the `initialize`
	 * request (to probe version negotiation); later frames keep the harness's
	 * revision.
	 */
	readonly initialize: (protocolVersion?: string) => Effect.Effect<JsonRpcMessage>;
	/** `server/discover` (meaningful on the stateless `2026-07-28` revision). */
	readonly discover: Effect.Effect<JsonRpcMessage>;
	readonly sendRequest: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage>;
	readonly listTools: Effect.Effect<ReadonlyArray<McpToolDescriptor>>;
	/** `tools/call`; resolves to the `CallToolResult`, or dies on a JSON-RPC error. */
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<unknown>;
	/** The first server-initiated frame with `method`, waiting for it if it has not arrived yet. */
	readonly awaitNotification: (method: string) => Effect.Effect<JsonRpcMessage>;
	/** Every stderr write and log line so far. */
	readonly stderrSoFar: Effect.Effect<string>;
	/** Every `console.log` call the server made (must stay empty — stdout is the wire). */
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** Simulates stdin EOF. */
	readonly close: Effect.Effect<void>;
}

export interface HarnessOptions {
	/** Extra layers merged beside `ServerLayer` (e.g. a throwaway `McpToolkit.layer` for a test tool). */
	readonly extraLayers?: ReadonlyArray<Layer.Layer<never>> | undefined;
	readonly serverVersion?: string | undefined;
	/** Runs against the built services before the server starts (seed the in-memory DB). */
	readonly seed?: Effect.Effect<void, never, HarnessServices> | undefined;
	/** The `McpSession` the server sees; defaults to `McpSession.layerTest({ cwd: process.cwd() })` (no recovered context). */
	readonly session?: Layer.Layer<McpSession> | undefined;
	/** The revision the client speaks; defaults to `2025-11-25`. `stateless: true` is `2026-07-28`. */
	readonly protocol?: McpProtocol.ProtocolAdapter | undefined;
	/** Speak the stateless `2026-07-28` protocol (SEP-2575): `server/discover` and per-request `_meta`. */
	readonly stateless?: boolean | undefined;
	/** The carrier identity `ping` reports, as `main.ts` provides it. */
	readonly distribution?: Distribution | undefined;
}

/** The stateless protocol revision. */
export const STATELESS_PROTOCOL = "2026-07-28";

const CLIENT_INFO = { name: "vitest-agent-test", version: "0.0.0" };

export const makeHarness = (options: HarnessOptions = {}): Effect.Effect<McpHarness, never, Scope.Scope> =>
	Effect.gen(function* () {
		const ServicesLayer = Layer.mergeAll(
			options.session ?? McpSession.layerTest({ cwd: process.cwd() }),
			DataStoreTestLayer,
			ProjectDiscoveryTest.layer([]),
		);
		// Built once so a `seed` (or a test, via `services`) talks to the same
		// in-memory store the server reads — providing `ServicesLayer` to the
		// server would build a second database. `DataStoreTestLayer` carries the
		// engine's platform layer, whose real process `Stdio` must not reach the
		// server: `McpHarness` supplies the queue-backed one.
		const built = yield* Layer.build(ServicesLayer).pipe(Effect.orDie);
		const services = Context.omit(Stdio.Stdio)(built) as Context.Context<HarnessServices>;
		if (options.seed !== undefined) yield* options.seed.pipe(Effect.provideContext(services));

		const server = Layer.mergeAll(
			ServerLayer({ version: options.serverVersion ?? "0.0.0-test" }),
			...(options.extraLayers ?? []),
		).pipe(
			Layer.provide(Layer.succeedContext(services)),
			Layer.provide(Layer.succeed(CurrentDistribution, Option.fromNullishOr(options.distribution))),
		);
		const protocol =
			options.stateless === true ? McpProtocol.v2026_07_28 : (options.protocol ?? McpProtocol.v2025_11_25);
		const kit = yield* KitHarness.make(server, { protocol, clientInfo: CLIENT_INFO });

		const initialize = (protocolVersion?: string): Effect.Effect<JsonRpcMessage> =>
			(protocolVersion === undefined || protocolVersion === protocol.protocolVersion
				? kit.initialize
				: kit
						.request("initialize", { protocolVersion, capabilities: {}, clientInfo: CLIENT_INFO })
						.pipe(Effect.tap(() => kit.notify("notifications/initialized")))
			).pipe(Effect.orDie);

		const callTool = (name: string, args?: unknown): Effect.Effect<unknown> =>
			kit.callTool(name, args).pipe(
				Effect.orDie,
				Effect.flatMap((message) =>
					message.error === undefined
						? Effect.succeed(message.result)
						: Effect.die(new Error(`JSON-RPC error: ${JSON.stringify(message.error)}`)),
				),
			);

		return {
			services,
			kit,
			initialize,
			discover: kit.discover.pipe(Effect.orDie),
			sendRequest: (method, params) => kit.request(method, params).pipe(Effect.orDie),
			listTools: kit.listTools.pipe(Effect.orDie),
			callTool,
			awaitNotification: (method) => kit.awaitOutboundMethod(method).pipe(Effect.orDie),
			stderrSoFar: kit.stderrSoFar,
			consoleLogSoFar: kit.consoleLogSoFar,
			close: kit.close,
		} satisfies McpHarness;
	});
