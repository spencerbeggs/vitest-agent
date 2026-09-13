/**
 * In-process stdio harness for the Effect-native MCP server, ported from
 * Effect's own `McpStdioHarness` (`.repos/effect/packages/effect/test/
 * unstable/ai/McpServer/TestUtils/McpStdioHarness.ts`). It builds the REAL
 * `ServerLayer` over `Stdio.layerTest` queues — no child process, no
 * sockets — so tests see the exact served schemas and wire results a real
 * client would.
 *
 * Effect log output (the server logs every tool defect) is routed into the
 * same stderr channel the `Stdio` service writes to, so `stderrSoFar`
 * captures both.
 */

import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import type { Cause, Scope } from "effect";
import { Deferred, Effect, Layer, Logger, Queue, References, Sink, Stdio, Stream } from "effect";
import { ServerLayer } from "../../src/server-layer.js";
import { McpSession } from "../../src/session.js";

export interface JsonRpcMessage {
	readonly jsonrpc: "2.0";
	readonly id?: string | number | null | undefined;
	readonly method?: string | undefined;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

export interface McpToolDescriptor {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: Record<string, unknown>;
	readonly outputSchema?: Record<string, unknown>;
	readonly annotations?: Record<string, unknown>;
}

export interface McpHarness {
	/** `initialize` + `notifications/initialized`; returns the initialize response. */
	readonly initialize: (protocolVersion?: string) => Effect.Effect<JsonRpcMessage>;
	readonly sendRequest: (method: string, params?: unknown, id?: string | number) => Effect.Effect<JsonRpcMessage>;
	readonly sendNotification: (method: string, params?: unknown) => Effect.Effect<void>;
	readonly listTools: Effect.Effect<ReadonlyArray<McpToolDescriptor>>;
	/** `tools/call`; resolves to the `CallToolResult`, or dies on a JSON-RPC error. */
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<unknown>;
	/** Every stderr chunk (and Effect log line) written so far. */
	readonly stderrSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** Simulates stdin EOF. */
	readonly close: Effect.Effect<void>;
}

export interface HarnessOptions {
	/** Extra already-provided layers (e.g. a throwaway `registerStrictToolkit` for a test tool). */
	readonly extraLayers?: ReadonlyArray<Layer.Layer<never>> | undefined;
	readonly serverVersion?: string | undefined;
}

const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage =>
	typeof value === "object" && value !== null && (value as JsonRpcMessage).jsonrpc === "2.0";

const isResponse = (message: JsonRpcMessage): message is JsonRpcMessage & { readonly id: string | number } =>
	(typeof message.id === "string" || typeof message.id === "number") && message.method === undefined;

const requestKey = (id: string | number) => `${typeof id}:${id}`;

const DEFAULT_PROTOCOL = "2025-11-25";

export const makeHarness = (options: HarnessOptions = {}): Effect.Effect<McpHarness, never, Scope.Scope> =>
	Effect.gen(function* () {
		const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
		const stdout = yield* Queue.unbounded<string | Uint8Array>();
		const stderr = yield* Queue.unbounded<string | Uint8Array>();
		const messages = yield* Queue.unbounded<JsonRpcMessage>();
		const responseQueues = new Map<string, Queue.Queue<JsonRpcMessage>>();
		const stderrLines: Array<string> = [];
		const encoder = new TextEncoder();
		const stdoutDecoder = new TextDecoder();
		const stderrDecoder = new TextDecoder();
		let nextRequestId = 1;

		const stdioLayer = Stdio.layerTest({
			stdin: Stream.fromQueue(stdin),
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach is an Effect sink, not Array.prototype.forEach
			stdout: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(stdout, chunk)),
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach is an Effect sink, not Array.prototype.forEach
			stderr: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(stderr, chunk)),
		});
		const stderrLogger = Logger.map(Logger.formatLogFmt, (line) => {
			stderrLines.push(line);
		});
		const loggerLayer = Layer.succeed(References.CurrentLoggers, new Set([stderrLogger]));

		// `DataStoreTestLayer` carries the engine's `NodePlatformLayer`, which
		// provides the REAL process `Stdio`. The queue-backed `stdioLayer` is
		// provided first (innermost) so it wins over that one.
		const ServicesLayer = Layer.mergeAll(
			McpSession.layerTest(),
			DataStoreTestLayer,
			OutputPipelineLive(process.env),
			ProjectDiscoveryTest.layer([]),
		);
		const Main = Layer.mergeAll(
			ServerLayer({ version: options.serverVersion ?? "0.0.0-test" }),
			...(options.extraLayers ?? []),
		).pipe(Layer.provide(stdioLayer), Layer.provide(ServicesLayer), Layer.provide(loggerLayer));

		const ready = yield* Deferred.make<void>();
		yield* Effect.gen(function* () {
			yield* Layer.build(Main);
			yield* Deferred.succeed(ready, undefined);
			return yield* Effect.never;
		}).pipe(Effect.scoped, Effect.forkScoped);
		yield* Deferred.await(ready);

		const routeFrame = (frame: unknown): Effect.Effect<void> => {
			if (!isJsonRpcMessage(frame)) return Effect.void;
			if (isResponse(frame)) {
				const responseQueue = responseQueues.get(requestKey(frame.id));
				if (responseQueue !== undefined) return Queue.offer(responseQueue, frame);
			}
			return Queue.offer(messages, frame);
		};

		yield* Effect.gen(function* () {
			let pending = "";
			while (true) {
				const chunk = yield* Queue.take(stdout);
				pending += typeof chunk === "string" ? chunk : stdoutDecoder.decode(chunk, { stream: true });
				let newline = pending.indexOf("\n");
				while (newline !== -1) {
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					if (line.length > 0) yield* routeFrame(JSON.parse(line));
					newline = pending.indexOf("\n");
				}
			}
		}).pipe(Effect.forkScoped);

		yield* Effect.gen(function* () {
			while (true) {
				const chunk = yield* Queue.take(stderr);
				stderrLines.push(typeof chunk === "string" ? chunk : stderrDecoder.decode(chunk, { stream: true }));
			}
		}).pipe(Effect.forkScoped);

		const sendRaw = (message: unknown) => Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`));
		const sendNotification = (method: string, params?: unknown): Effect.Effect<void> =>
			sendRaw({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }).pipe(Effect.asVoid);
		const sendRequest = (method: string, params?: unknown, id: string | number = nextRequestId++) =>
			Effect.gen(function* () {
				const responseQueue = yield* Queue.unbounded<JsonRpcMessage>();
				const key = requestKey(id);
				responseQueues.set(key, responseQueue);
				yield* sendRaw({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
				return yield* Queue.take(responseQueue).pipe(Effect.ensuring(Effect.sync(() => responseQueues.delete(key))));
			});

		const initialize = (protocolVersion: string = DEFAULT_PROTOCOL) =>
			Effect.gen(function* () {
				const response = yield* sendRequest("initialize", {
					protocolVersion,
					capabilities: {},
					clientInfo: { name: "vitest-agent-test", version: "0.0.0" },
				});
				yield* sendNotification("notifications/initialized");
				return response;
			});

		const unwrapResult = (message: JsonRpcMessage): Effect.Effect<unknown> =>
			message.error === undefined
				? Effect.succeed(message.result)
				: Effect.die(new Error(`JSON-RPC error: ${JSON.stringify(message.error)}`));

		const listTools = sendRequest("tools/list").pipe(
			Effect.flatMap(unwrapResult),
			Effect.map((result) => (result as { tools: ReadonlyArray<McpToolDescriptor> }).tools),
		);
		const callTool = (name: string, args?: unknown) =>
			sendRequest("tools/call", { name, arguments: args ?? {} }).pipe(Effect.flatMap(unwrapResult));

		return {
			initialize,
			sendRequest,
			sendNotification,
			listTools,
			callTool,
			stderrSoFar: Effect.sync(() => [...stderrLines]),
			close: Queue.end(stdin).pipe(Effect.asVoid),
		} satisfies McpHarness;
	});
