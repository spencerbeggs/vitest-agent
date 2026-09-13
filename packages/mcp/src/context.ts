import { initTRPC } from "@trpc/server";
import type { DataReader, DataStore, OutputRenderer, ProjectDiscovery, SessionContext } from "@vitest-agent/engine";
import type { ManagedRuntime } from "effect";
import type { CurrentSessionIdRef, SessionContextRef } from "./session.js";

/**
 * The session refs now live in `session.ts` (next to the `McpSession`
 * service); they are re-exported here so the tRPC-era import paths keep
 * resolving until the old server is deleted.
 */
export type { CurrentSessionIdRef, SessionContextRef } from "./session.js";
export { createCurrentSessionIdRef, createSessionContextRef, sessionContextFromEnv } from "./session.js";

/**
 * `SessionContext` is declared by `@vitest-agent/engine` (next to the
 * session-env recovery program that produces it) and re-exported here so
 * the MCP barrel keeps its public name.
 */
export type { SessionContext };

/**
 * tRPC context carrying a ManagedRuntime for Effect service access.
 *
 * The MCP server creates a ManagedRuntime at startup (long-lived
 * process) and passes it through tRPC context so procedures can
 * call Effect services via `ctx.runtime.runPromise(effect)`.
 *
 * @public
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
/**
 * Factory for creating server-side tRPC callers for the MCP router.
 *
 * Use with {@link appRouter} in tests or programmatic contexts to invoke
 * tool procedures without starting the MCP server.
 *
 * @public
 */
export const createCallerFactory = t.createCallerFactory;
/** Exported so middleware modules can attach to the same tRPC instance. */
export const middleware = t.middleware;
