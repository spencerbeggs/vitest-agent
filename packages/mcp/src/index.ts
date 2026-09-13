/**
 * @vitest-agent/mcp
 *
 * Model Context Protocol server for vitest-agent. Exposes 29 tools
 * via tRPC over stdio that give agents structured access to test data,
 * coverage, history, trends, errors, and notes — backed by the SQLite
 * database that the reporter writes during test runs.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent-mcp` bin) over `main.ts` (published as `./main` so the
 * carrier can ship the same bin); this barrel re-exports the supporting
 * pieces for programmatic use and never imports `main.ts`.
 *
 * @packageDocumentation
 */

export { RenderText } from "./annotations.js";
export type { CurrentSessionIdRef, McpContext, SessionContext, SessionContextRef } from "./context.js";
export { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "./context.js";
export { withIdempotency } from "./idempotency.js";
export { registerStrictToolkit } from "./register-toolkit.js";
export { appRouter } from "./router.js";
export { buildMcpServer, startMcpServer } from "./server.js";
export type { PlatformServices, ServerLayerOptions } from "./server-layer.js";
export { ServerLayer } from "./server-layer.js";
export type { McpSessionOptions } from "./session.js";
export { McpSession } from "./session.js";
export { Kit, ToolsLayer, toolHandlers } from "./toolkit.js";
// `parseSessionEnvExports` / `recoverSessionContextFromSessionEnv` moved
// to `@vitest-agent/engine` (#412); import them from there.
export type { Remediation, TddErrorEnvelope } from "./tools/_tdd-error-envelope.js";
export type { HelpResultType } from "./tools/help.js";
export { HelpResult } from "./tools/help.js";
export type { PingResultType } from "./tools/ping.js";
export { PingResult } from "./tools/ping.js";
export { CURRENT_MCP_VERSION } from "./version.js";
