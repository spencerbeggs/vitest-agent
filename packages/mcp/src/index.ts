/**
 * @vitest-agent/mcp
 *
 * Model Context Protocol server for vitest-agent, built on Effect's
 * native `McpServer` (`effect/unstable/ai`). Exposes 30 tools (one
 * `Tool.make` per file under `tools/`, assembled in `toolkit.ts` and
 * registered under the strict-input contract by `register-toolkit.ts`)
 * plus six framing prompts (`prompts/layer.ts`) over stdio, giving agents
 * structured access to test data, coverage, history, trends, errors,
 * notes and the TDD lifecycle — backed by the SQLite database that the
 * reporter writes during test runs.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent-mcp` bin) over `main.ts` (published as `./main` so the
 * carrier can ship the same bin); this barrel re-exports the supporting
 * pieces for programmatic use and never imports `main.ts`.
 *
 * @packageDocumentation
 */

export { RenderText } from "./annotations.js";
export { withIdempotency } from "./idempotency.js";
export { PromptsLayer } from "./prompts/layer.js";
export { registerStrictToolkit } from "./register-toolkit.js";
export type { PlatformServices, ServerLayerOptions } from "./server.js";
export { ServerLayer } from "./server.js";
export type { CurrentSessionIdRef, McpSessionOptions, SessionContext, SessionContextRef } from "./session.js";
export { McpSession, createCurrentSessionIdRef, createSessionContextRef, sessionContextFromEnv } from "./session.js";
export { Kit, ToolsLayer, toolHandlers } from "./toolkit.js";
// `parseSessionEnvExports` / `recoverSessionContextFromSessionEnv` moved
// to `@vitest-agent/engine` (#412); import them from there.
export type { Remediation, TddErrorEnvelope } from "./tools/_tdd-error-envelope.js";
export type { HelpResultType } from "./tools/help.js";
export { HelpResult } from "./tools/help.js";
export type { PingResultType } from "./tools/ping.js";
export { PingResult } from "./tools/ping.js";
export { CURRENT_MCP_VERSION } from "./version.js";
