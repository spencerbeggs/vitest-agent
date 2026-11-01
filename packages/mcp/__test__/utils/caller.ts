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
 * Replay: production builds its handlers once over a replay store read from
 * `DataReader` / `DataStore` at layer build (`toolHandlers`). A caller's
 * runtime may carry only `DataReader`, so the caller builds the same record
 * once through `makeToolHandlers` over a store that resolves both services
 * when a replayed tool touches it. Only the four replayed write tools touch
 * it, and their requirements already include `DataReader | DataStore`, so a
 * runtime that can call them provides both. The replay semantics themselves
 * are pinned by `replay.test.ts`.
 *
 * `McpSession` is the one service provided PER CALL rather than by the
 * runtime: each test supplies its own `cwd` and refs over a shared runtime
 * through `session` (`McpSession.layer({...})` /
 * `McpSession.layerTest({...})`). A runtime that also carries `McpSession`
 * is shadowed by `session`.
 */

import type { ToolReplayStore } from "@effected/mcp";
import type { Layer, ManagedRuntime } from "effect";
import { Effect, Schema } from "effect";
import { makeReplayStore } from "../../src/replay.js";
import { McpSession } from "../../src/session.js";
import { Kit, makeToolHandlers } from "../../src/toolkit.js";

type Handlers = ReturnType<typeof makeToolHandlers>;

/**
 * The replay store over the calling runtime's own `DataReader` / `DataStore`.
 * Its `R` is erased to fit `ToolReplayStore`; see the module comment for why
 * every runtime that reaches it provides both.
 */
const runtimeReplayStore = {
	get: (key: string) => Effect.flatMap(makeReplayStore, (store) => store.get(key)),
	set: (key: string, value: string) => Effect.flatMap(makeReplayStore, (store) => store.set(key, value)),
} as unknown as ToolReplayStore;
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
 * `PlatformLiveError`), which never reaches a handler.
 */
export const makeCaller = <R, ER>(
	runtime: ManagedRuntime.ManagedRuntime<R, ER>,
	session: Layer.Layer<McpSession> = McpSession.layerTest({ cwd: process.cwd() }),
): ToolCaller<R> => {
	const handlers = makeToolHandlers(runtimeReplayStore);
	return (name, params) => {
		const handler = handlers[name] as (p: unknown) => Effect.Effect<unknown, never, R | McpSession>;
		const decode = Schema.decodeUnknownEffect(Kit.tools[name].parametersSchema as Schema.Codec<unknown>);
		return runtime.runPromise(decode(params ?? {}).pipe(Effect.flatMap(handler), Effect.provide(session))) as never;
	};
};
