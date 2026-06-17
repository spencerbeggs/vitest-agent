/**
 * @vitest-agent/cli
 *
 * On-demand CLI for vitest-agent. Reads cached test data and
 * reports status, overview, coverage, history, trends, and cache health.
 *
 * The default entry point is `bin.ts` (registered as the
 * `vitest-agent` bin); this barrel re-exports the supporting
 * pieces for programmatic use.
 *
 * @packageDocumentation
 */

export { CliLive } from "./layers/CliLive.js";
export { SidecarLive, type SidecarPaths } from "./layers/SidecarLive.js";
export {
	type RegisterAgentInput,
	type RegisterAgentOutput,
	registerAgentEffect,
} from "./lib/internal-register-agent.js";
export {
	DATA_DB_FILENAME,
	REGISTRY_DB_FILENAME,
	SESSIONS_DB_FILENAME,
	resolveProjectDataDir,
	resolveRegistryDir,
	resolveSessionMapPath,
} from "./lib/sidecar-paths.js";

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * Compared against CURRENT_SDK_VERSION at CLI bin init to surface
 * partially-upgraded installs as a single stderr warning. See the root
 * CLAUDE.md "Cross-package version drift" section.
 */
export const CURRENT_CLI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
