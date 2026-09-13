// The per-process MCP session: the working directory the server was
// launched for, the currently-associated host chat id, and the recovered
// `SessionContext`. One MCP process serves one host window, so a single
// `McpSession` service carrying two mutable refs is enough — no
// cross-window contention.

import type { SessionContext } from "@vitest-agent/engine";
import { Context, Layer, MutableRef } from "effect";

/**
 * `SessionContext` is declared by `@vitest-agent/engine` (next to the
 * session-env recovery program that produces it) and re-exported here so
 * the MCP barrel keeps its public name.
 *
 * @public
 */
export type { SessionContext };

/**
 * Mutable holder for the MCP server's currently-associated host chat
 * id (the per-process CC chat UUID).
 *
 * The bin entry seeds the value from `VITEST_AGENT_CHAT_ID` (written by
 * the SessionStart hook to `CLAUDE_ENV_FILE` and auto-sourced into the
 * MCP child) or from an explicit positional argv.
 *
 * @public
 */
export interface CurrentSessionIdRef {
	get(): string | null;
	set(id: string | null): void;
}

/**
 * Creates a new `CurrentSessionIdRef` with an optional initial value.
 *
 * @param initial - the starting chat id, or `null` when unknown at construction time
 * @returns a mutable ref holding the current session id
 * @public
 */
export const createCurrentSessionIdRef = (initial: string | null = null): CurrentSessionIdRef => {
	const ref = MutableRef.make<string | null>(initial);
	return {
		get: () => MutableRef.get(ref),
		set: (id) => {
			MutableRef.set(ref, id);
		},
	};
};

/**
 * Mutable ref holding the MCP server's recovered `SessionContext`.
 *
 * @public
 */
export interface SessionContextRef {
	get(): SessionContext | null;
	set(ctx: SessionContext | null): void;
}

/**
 * Creates a new `SessionContextRef` with an optional initial value.
 *
 * When a `recover` thunk is supplied, `get()` invokes it lazily while the
 * held value is `null` and caches the first non-null result. This is how
 * a null boot-time context heals at the first tool call that needs it:
 * boot-time env recovery loses both the fresh-launch race (the MCP child
 * can spawn before SessionStart writes `CLAUDE_ENV_FILE`) and the
 * `/reload-plugins` restart (fresh environment, no session exports), but
 * by first-tool-call time the SessionStart hook's session-env file is on
 * disk for the recover thunk to read.
 *
 * @param initial - the starting session context, or `null` when not yet recovered
 * @param recover - optional call-time recovery attempted by `get()` while the value is `null`
 * @returns a mutable ref holding the current session context
 * @public
 */
export const createSessionContextRef = (
	initial: SessionContext | null = null,
	recover?: () => SessionContext | null,
): SessionContextRef => {
	let value: SessionContext | null = initial;
	return {
		get: () => {
			if (value === null && recover !== undefined) {
				value = recover();
			}
			return value;
		},
		set: (ctx) => {
			value = ctx;
		},
	};
};

/**
 * Resolve the boot-time SessionContext from an environment map (the
 * primary path: SessionStart wrote the exports to `CLAUDE_ENV_FILE` and
 * Claude Code auto-sources that file into the MCP server child).
 *
 * Returns `null` when any required value is absent — callers can still
 * attempt the session-map fallback before giving up.
 *
 * @param env - the environment map to read; the bin passes `process.env`
 * @public
 */
export const sessionContextFromEnv = (env: Record<string, string | undefined>): SessionContext | null => {
	const chatId = env.VITEST_AGENT_CHAT_ID;
	const conversationId = env.VITEST_AGENT_CONVERSATION_ID;
	const mainAgentId = env.VITEST_AGENT_MAIN_AGENT_ID ?? env.VITEST_AGENT_AGENT_ID;
	if (chatId === undefined || conversationId === undefined || mainAgentId === undefined) return null;
	if (chatId.length === 0 || conversationId.length === 0 || mainAgentId.length === 0) return null;
	return { chatId, conversationId, mainAgentId };
};

/**
 * Options for `McpSession.layer`.
 *
 * @public
 */
export interface McpSessionOptions {
	readonly cwd: string;
	readonly initialSessionId: string | null;
	readonly initialContext: SessionContext | null;
	readonly recover?: (() => SessionContext | null) | undefined;
}

/**
 * The per-process MCP session service consumed by tool handlers.
 *
 * @public
 */
export class McpSession extends Context.Service<
	McpSession,
	{
		readonly cwd: string;
		readonly currentSessionId: CurrentSessionIdRef;
		readonly sessionContext: SessionContextRef;
	}
>()("@vitest-agent/mcp/McpSession") {
	/**
	 * The live session: seeded from the bin's boot-time recovery, healing
	 * lazily through `recover` on the first `sessionContext.get()` that
	 * finds a `null` context.
	 */
	static readonly layer = (options: McpSessionOptions): Layer.Layer<McpSession> =>
		Layer.succeed(McpSession, {
			cwd: options.cwd,
			currentSessionId: createCurrentSessionIdRef(options.initialSessionId),
			sessionContext: createSessionContextRef(options.initialContext, options.recover),
		});

	/**
	 * A test session: `cwd` is the caller's (this module is process-free,
	 * so the test harness passes `process.cwd()` itself), both refs start
	 * `null`, and either can be overridden.
	 */
	static readonly layerTest = (
		overrides: Pick<McpSessionOptions, "cwd"> & Partial<McpSessionOptions>,
	): Layer.Layer<McpSession> =>
		McpSession.layer({
			cwd: overrides.cwd,
			initialSessionId: overrides.initialSessionId ?? null,
			initialContext: overrides.initialContext ?? null,
			...(overrides.recover === undefined ? {} : { recover: overrides.recover }),
		});
}
