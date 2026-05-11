import { initTRPC } from "@trpc/server";
import type { ManagedRuntime } from "effect";
import type { DataReader, DataStore, OutputRenderer, ProjectDiscovery } from "vitest-agent-sdk";

/**
 * Mutable holder for the MCP server's currently-associated host chat
 * id (the per-process CC chat UUID).
 *
 * The MCP server is one process per host window, so a single in-memory
 * ref is enough — no cross-window contention. The bin entry seeds the
 * value from `process.env.VITEST_AGENT_CHAT_ID` (written by the
 * SessionStart hook to `CLAUDE_ENV_FILE` and auto-sourced into the MCP
 * child) or from an explicit positional argv. The legacy
 * `set_current_session_id` MCP tool was removed in Phase 3.
 */
export interface CurrentSessionIdRef {
	get(): string | null;
	set(id: string | null): void;
}

export const createCurrentSessionIdRef = (initial: string | null = null): CurrentSessionIdRef => {
	let value: string | null = initial;
	return {
		get: () => value,
		set: (id) => {
			value = id;
		},
	};
};

/**
 * Recovered session attribution context — the canonical UUIDs the
 * SessionStart hook wrote to `${CLAUDE_ENV_FILE}` so they auto-source
 * into the MCP server child's `process.env`, with the per-client
 * session map as a fallback when the env vars are missing (dev /
 * tests).
 *
 * Read by `run_tests` to populate `VITEST_AGENT_AGENT_ID` and friends
 * on the Vitest child process so the reporter attributes runs back to
 * the active agent.
 */
export interface SessionContext {
	readonly chatId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
}

export interface SessionContextRef {
	get(): SessionContext | null;
	set(ctx: SessionContext | null): void;
}

export const createSessionContextRef = (initial: SessionContext | null = null): SessionContextRef => {
	let value: SessionContext | null = initial;
	return {
		get: () => value,
		set: (ctx) => {
			value = ctx;
		},
	};
};

/**
 * Resolve the boot-time SessionContext from `process.env` (the
 * primary path: SessionStart wrote the exports to `CLAUDE_ENV_FILE`
 * and Claude Code auto-sources that file into the MCP server child).
 *
 * Returns `null` when any required value is absent — callers can
 * still attempt the session-map fallback before giving up.
 */
export const sessionContextFromEnv = (env: Record<string, string | undefined> = process.env): SessionContext | null => {
	const chatId = env.VITEST_AGENT_CHAT_ID;
	const conversationId = env.VITEST_AGENT_CONVERSATION_ID;
	const mainAgentId = env.VITEST_AGENT_MAIN_AGENT_ID ?? env.VITEST_AGENT_AGENT_ID;
	if (chatId === undefined || conversationId === undefined || mainAgentId === undefined) return null;
	if (chatId.length === 0 || conversationId.length === 0 || mainAgentId.length === 0) return null;
	return { chatId, conversationId, mainAgentId };
};

/**
 * tRPC context carrying a ManagedRuntime for Effect service access.
 *
 * The MCP server creates a ManagedRuntime at startup (long-lived
 * process) and passes it through tRPC context so procedures can
 * call Effect services via `ctx.runtime.runPromise(effect)`.
 */
export interface McpContext {
	readonly runtime: ManagedRuntime.ManagedRuntime<DataReader | DataStore | ProjectDiscovery | OutputRenderer, never>;
	readonly cwd: string;
	readonly currentSessionId: CurrentSessionIdRef;
	readonly sessionContext: SessionContextRef;
}

const t = initTRPC.context<McpContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
/** Exported so middleware modules can attach to the same tRPC instance. */
export const middleware = t.middleware;
