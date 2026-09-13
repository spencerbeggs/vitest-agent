/**
 * Direct handler caller for the Effect-native tools — the replacement for
 * the tRPC `createCallerFactory(appRouter)` caller. It decodes `params`
 * through the tool's `parameters` schema (the same step `Toolkit.handle`
 * performs, so an invalid input REJECTS exactly as the tRPC input
 * validation did) and then invokes `toolHandlers[name]` straight on a
 * `ManagedRuntime`, bypassing the wire (no JSON Schema strictness, no
 * result encoding), so a test can assert the handler's DECODED result with
 * full type narrowing.
 *
 * The runtime must provide exactly what the registered handlers require
 * (`HandlerRequirements`, derived from `toolHandlers`) — today that is
 * `DataReader` alone, so a test may hand in a runtime built from a stubbed
 * `DataReader` layer. When a Task 16 handler adds `McpSession` (or another
 * service) to its requirements, the derived type widens and the runtime
 * must provide it; nothing is provided implicitly here.
 */

import type { ManagedRuntime } from "effect";
import { Effect, Schema } from "effect";
import { Kit, toolHandlers } from "../../src/toolkit.js";

type Handlers = typeof toolHandlers;
export type ToolName = keyof Handlers;
export type ToolParams<Name extends ToolName> = Parameters<Handlers[Name]>[0];
export type ToolResult<Name extends ToolName> = Effect.Success<ReturnType<Handlers[Name]>>;
/** The union of every registered handler's service requirements. */
export type HandlerRequirements = Effect.Services<ReturnType<Handlers[ToolName]>>;

export type ToolCaller = <Name extends ToolName>(name: Name, params: ToolParams<Name>) => Promise<ToolResult<Name>>;

/**
 * The runtime must provide at least `HandlerRequirements` (a wider runtime
 * is accepted — `ManagedRuntime` is contravariant in its services). `ER`
 * is the runtime's own build error (the engine test layer carries
 * `MigrationError | SqlError`), which never reaches a handler.
 */
export const makeCaller = <ER>(runtime: ManagedRuntime.ManagedRuntime<HandlerRequirements, ER>): ToolCaller => {
	return (name, params) => {
		const handler = toolHandlers[name] as (p: unknown) => Effect.Effect<unknown, never, HandlerRequirements>;
		const decode = Schema.decodeUnknownEffect(Kit.tools[name].parametersSchema as Schema.Codec<unknown>);
		return runtime.runPromise(decode(params ?? {}).pipe(Effect.flatMap(handler))) as never;
	};
};
