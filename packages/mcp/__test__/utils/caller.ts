/**
 * Direct handler caller for the Effect-native tools — the replacement for
 * the tRPC `createCallerFactory(appRouter)` caller. It invokes
 * `toolHandlers[name]` straight on a `ManagedRuntime`, bypassing the wire
 * (no JSON Schema strictness, no encode/decode), so a test can assert the
 * handler's DECODED result with full type narrowing.
 *
 * `McpSession` is provided per call from `McpSession.layerTest()` (or the
 * layer the caller was built with) rather than baked into the runtime, so
 * the runtime stays the plain engine `TestLayer` every old test already
 * builds.
 */

import type { DataReader, DataStore, OutputRenderer, ProjectDiscovery } from "@vitest-agent/engine";
import type { Layer, ManagedRuntime } from "effect";
import { Effect } from "effect";
import { McpSession } from "../../src/session.js";
import { toolHandlers } from "../../src/toolkit.js";

type Handlers = typeof toolHandlers;
export type ToolName = keyof Handlers;
export type ToolParams<Name extends ToolName> = Parameters<Handlers[Name]>[0];
export type ToolResult<Name extends ToolName> = Effect.Effect.Success<ReturnType<Handlers[Name]>>;

export type ToolCaller = <Name extends ToolName>(name: Name, params: ToolParams<Name>) => Promise<ToolResult<Name>>;

export const makeCaller = (
	runtime: ManagedRuntime.ManagedRuntime<DataReader | DataStore | ProjectDiscovery | OutputRenderer, never>,
	session: Layer.Layer<McpSession> = McpSession.layerTest(),
): ToolCaller => {
	return (name, params) => {
		const handler = toolHandlers[name] as (
			p: unknown,
		) => Effect.Effect<unknown, never, McpSession | DataReader | DataStore | ProjectDiscovery | OutputRenderer>;
		return runtime.runPromise(handler(params).pipe(Effect.provide(session))) as never;
	};
};
