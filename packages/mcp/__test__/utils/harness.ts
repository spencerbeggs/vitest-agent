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

import type { DataReader, DataStore, OutputRenderer, ProjectDiscovery } from "@vitest-agent/engine";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/engine";
import { DataStoreTestLayer } from "@vitest-agent/engine/testing";
import type { Cause, Context, Scope } from "effect";
import { Console, Deferred, Effect, Layer, Logger, Queue, References, Sink, Stdio, Stream } from "effect";
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

export interface McpToolDescriptor {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly inputSchema: Record<string, unknown>;
	readonly outputSchema?: Record<string, unknown>;
	readonly annotations?: Record<string, unknown>;
}

/** The services the harness builds for the server (and hands to `seed` / `services`). */
export type HarnessServices = McpSession | DataReader | DataStore | ProjectDiscovery | OutputRenderer;

export interface McpHarness {
	/** The built service context: run a seeding effect against the SAME in-memory store the server reads. */
	readonly services: Context.Context<HarnessServices>;
	/** `initialize` + `notifications/initialized`; returns the initialize response. */
	readonly initialize: (protocolVersion?: string) => Effect.Effect<JsonRpcMessage>;
	readonly sendRequest: (method: string, params?: unknown, id?: string | number) => Effect.Effect<JsonRpcMessage>;
	readonly sendNotification: (method: string, params?: unknown) => Effect.Effect<void>;
	readonly listTools: Effect.Effect<ReadonlyArray<McpToolDescriptor>>;
	/** `tools/call`; resolves to the `CallToolResult`, or dies on a JSON-RPC error. */
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<unknown>;
	/** Every stderr chunk (and Effect log line, or `console.error` call under the default logger) written so far. */
	readonly stderrSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** Every raw stdout chunk written so far (the JSON-RPC wire, unparsed). */
	readonly rawStdoutSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** Every `console.log` call the server made (should stay empty — stdout is the wire). */
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** Simulates stdin EOF. */
	readonly close: Effect.Effect<void>;
}

export interface HarnessOptions {
	/** Extra already-provided layers (e.g. a throwaway `registerStrictToolkit` for a test tool). */
	readonly extraLayers?: ReadonlyArray<Layer.Layer<never>> | undefined;
	readonly serverVersion?: string | undefined;
	/**
	 * Keep Effect's DEFAULT logger (which writes through the `Console`
	 * reference) instead of the harness's stderr-buffer logger, with a
	 * captured `Console` so `console.log` vs `console.error` routing is
	 * observable. This is how `Logger.LogToStderr` is proven.
	 */
	readonly useDefaultLogger?: boolean | undefined;
	/** Runs against the built services before the server starts (seed the in-memory DB). */
	readonly seed?: Effect.Effect<void, never, HarnessServices> | undefined;
	/** The `McpSession` the server sees; defaults to `McpSession.layerTest({ cwd: process.cwd() })` (no recovered context). */
	readonly session?: Layer.Layer<McpSession> | undefined;
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
		const rawStdout: Array<string> = [];
		const consoleLog: Array<string> = [];
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
		const format = (args: ReadonlyArray<unknown>) => args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
		const capturedConsole: Console.Console = {
			...globalThis.console,
			log: (...args) => {
				consoleLog.push(format(args));
			},
			error: (...args) => {
				stderrLines.push(format(args));
			},
		};
		const loggerLayer =
			options.useDefaultLogger === true
				? Layer.succeed(Console.Console, capturedConsole)
				: Layer.succeed(References.CurrentLoggers, new Set([stderrLogger]));

		// `DataStoreTestLayer` carries the engine's `NodePlatformLayer`, which
		// provides the REAL process `Stdio`. The queue-backed `stdioLayer` is
		// provided first (innermost) so it wins over that one.
		const ServicesLayer = Layer.mergeAll(
			options.session ?? McpSession.layerTest({ cwd: process.cwd() }),
			DataStoreTestLayer,
			OutputPipelineLive(process.env),
			ProjectDiscoveryTest.layer([]),
		);
		// Built once here so a `seed` (or a test, via `services`) talks to the
		// same in-memory store the server reads — providing `ServicesLayer`
		// twice would build two databases.
		const services = yield* Layer.build(ServicesLayer).pipe(Effect.orDie);
		if (options.seed !== undefined) yield* options.seed.pipe(Effect.provideContext(services));
		const Main = Layer.mergeAll(
			ServerLayer({ version: options.serverVersion ?? "0.0.0-test" }),
			...(options.extraLayers ?? []),
		).pipe(Layer.provide(stdioLayer), Layer.provide(Layer.succeedContext(services)), Layer.provide(loggerLayer));

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
				const text = typeof chunk === "string" ? chunk : stdoutDecoder.decode(chunk, { stream: true });
				rawStdout.push(text);
				pending += text;
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
			services,
			initialize,
			sendRequest,
			sendNotification,
			listTools,
			callTool,
			stderrSoFar: Effect.sync(() => [...stderrLines]),
			rawStdoutSoFar: Effect.sync(() => [...rawStdout]),
			consoleLogSoFar: Effect.sync(() => [...consoleLog]),
			close: Queue.end(stdin).pipe(Effect.asVoid),
		} satisfies McpHarness;
	});
