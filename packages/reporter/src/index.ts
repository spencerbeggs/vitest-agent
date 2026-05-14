/**
 * vitest-agent-reporter
 *
 * Default reporter implementations for the {@link
 * https://npmjs.com/package/vitest-agent | vitest-agent} plugin.
 *
 * Each export implements the `VitestAgentReporter` contract from
 * `vitest-agent-sdk`: given resolved config + assembled per-run data, it
 * returns `RenderedOutput[]`. The plugin owns persistence and Vitest
 * lifecycle wiring; reporters are pure rendering callbacks.
 *
 * @packageDocumentation
 */

export { ciAnnotationsReporter } from "./ci-annotations.js";
export { defaultReporter } from "./default.js";
export { githubSummaryReporter } from "./github-summary.js";
export { jsonReporter } from "./json.js";
export { markdownReporter } from "./markdown.js";
export { silentReporter } from "./silent.js";
export { terminalReporter } from "./terminal.js";

// --- Cross-package version constant (T12 drift check) ---
/**
 * The version of this package, inlined at build time from
 * package.json#version via rslib-builder's __PACKAGE_VERSION__ substitution.
 * The reporter is consumed through the plugin so it does not run its own
 * init-time drift check, but the constant is exported so the plugin can
 * compare against it. See the root CLAUDE.md "Cross-package version drift"
 * section.
 */
export const CURRENT_REPORTER_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
