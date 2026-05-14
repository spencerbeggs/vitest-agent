/**
 * vitest-agent-cli
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

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * Compared against CURRENT_SDK_VERSION at CLI bin init to surface
 * partially-upgraded installs as a single stderr warning. See the root
 * CLAUDE.md "Cross-package version drift" section.
 */
export const CURRENT_CLI_VERSION: string = process.env.__PACKAGE_VERSION__!;
