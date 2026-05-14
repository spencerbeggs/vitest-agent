/**
 * vitest-agent-mcp
 *
 * Model Context Protocol server for vitest-agent. Exposes 24 tools
 * via tRPC over stdio that give agents structured access to test data,
 * coverage, history, trends, errors, and notes — backed by the SQLite
 * database that the reporter writes during test runs.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent-mcp` bin); this barrel re-exports the supporting
 * pieces for programmatic use.
 *
 * @packageDocumentation
 */

export type { CurrentSessionIdRef, McpContext, SessionContext, SessionContextRef } from "./context.js";
export { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "./context.js";
export { McpLive } from "./layers/McpLive.js";
export { appRouter } from "./router.js";
export { startMcpServer } from "./server.js";
export type { Remediation, TddErrorEnvelope } from "./tools/_tdd-error-envelope.js";

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * Compared against CURRENT_SDK_VERSION at MCP bin init to surface
 * partially-upgraded installs as a single stderr warning. See the root
 * CLAUDE.md "Cross-package version drift" section.
 */
export const CURRENT_MCP_VERSION: string = process.env.__PACKAGE_VERSION__!;
