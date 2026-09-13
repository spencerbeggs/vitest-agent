/**
 * Direct handler caller for the Effect-native tools. It decodes `params`
 * through the tool's `parameters` schema (the same step `Toolkit.handle`
 * performs, so an invalid input REJECTS exactly as the served tool would)
 * and then invokes `toolHandlers[name]` straight on a `ManagedRuntime`,
 * bypassing the wire (no JSON Schema strictness, no result encoding), so a
 * test can assert the handler's DECODED result with full type narrowing.
 * Wire-exact behavior belongs to `harness.ts`, which runs the real
 * `ServerLayer` over in-process stdio queues.
 *
 * Requirements are checked per tool: the returned caller accepts only the
 * tools whose handler requirements (minus `McpSession`) the runtime
 * provides — a `DataReader`-only runtime can call the read-only tools and
 * nothing else, and the mismatch is a compile error at the call site, not
 * a missing-service defect at run time.
 *
 * `McpSession` is the one service provided PER CALL rather than by the
 * runtime: each test supplies its own `cwd` and refs over a shared runtime
 * through `session` (`McpSession.layer({...})` /
 * `McpSession.layerTest({...})`). A runtime that also carries `McpSession`
 * is shadowed by `session`.
 */

import type { Layer, ManagedRuntime } from "effect";
import { Effect, Schema } from "effect";
import { McpSession } from "../../src/session.js";
import { Kit, toolHandlers } from "../../src/toolkit.js";

type Handlers = typeof toolHandlers;
export type ToolName = keyof Handlers;
/** The wire (encoded) shape of a tool's parameters — a numeric-string id is accepted where the schema coerces one. */
export type ToolParams<Name extends ToolName> =
	Parameters<Handlers[Name]> extends []
		? undefined | Record<string, never>
		: Schema.Codec.Encoded<(typeof Kit.tools)[Name]["parametersSchema"]>;
export type ToolResult<Name extends ToolName> = Effect.Success<ReturnType<Handlers[Name]>>;
/** The services a tool's handler requires beyond the per-call `McpSession`. */
export type ToolRequirements<Name extends ToolName> = Exclude<Effect.Services<ReturnType<Handlers[Name]>>, McpSession>;
/** The union of every registered handler's service requirements. */
export type HandlerRequirements = ToolRequirements<ToolName>;
/** The tools a runtime providing `R` can call. */
export type CallableTools<R> = { [Name in ToolName]: ToolRequirements<Name> extends R ? Name : never }[ToolName];

export type ToolCaller<R> = <Name extends CallableTools<R>>(
	name: Name,
	params: ToolParams<Name>,
) => Promise<ToolResult<Name>>;

/**
 * `ER` is the runtime's own build error (the engine test layer carries
 * `MigrationError | SqlError`), which never reaches a handler.
 */
export const makeCaller = <R, ER>(
	runtime: ManagedRuntime.ManagedRuntime<R, ER>,
	session: Layer.Layer<McpSession> = McpSession.layerTest({ cwd: process.cwd() }),
): ToolCaller<R> => {
	return (name, params) => {
		const handler = toolHandlers[name] as (p: unknown) => Effect.Effect<unknown, never, R | McpSession>;
		const decode = Schema.decodeUnknownEffect(Kit.tools[name].parametersSchema as Schema.Codec<unknown>);
		return runtime.runPromise(decode(params ?? {}).pipe(Effect.flatMap(handler), Effect.provide(session))) as never;
	};
};
