/**
 * vitest-agent-reporter
 *
 * The "build your own reporter" SDK for the vitest-agent plugin.
 * After the 2.0 UI rewrite, the plugin ships its own preassembled
 * default reporter inside vitest-agent-ui; this package no longer
 * exports a shipped default. Users who want a custom rendering
 * strategy implement the VitestAgentReporterFactory contract from
 * vitest-agent-sdk and pass it as the plugin's reporter option.
 *
 * The exports here are convenience re-exports of the contract types
 * and the stream-consumption helpers a custom reporter typically
 * needs. Open question for a 2.x follow-up: fold this package into
 * vitest-agent-ui or vitest-agent-sdk. The separation is locked for
 * 2.0 to keep the dependency story clean for custom-reporter authors,
 * but the surface area is small enough that consolidation is worth
 * revisiting.
 *
 * @packageDocumentation
 */

// Factory contract type re-exports from the SDK so a custom-reporter
// author can pull everything they need from one package without
// adding vitest-agent-sdk as a direct dependency.
export type {
	RenderedOutput,
	ReporterKit,
	ReporterRenderInput,
	ResolvedReporterConfig,
	VitestAgentReporter,
	VitestAgentReporterFactory,
} from "vitest-agent-sdk";
// Stream-consumption helpers from vitest-agent-ui. The
// buildDispatchInputs and resolveCellOptions helpers let a custom
// reporter reuse the same inputs assembly the preassembled default
// uses.
export { buildDispatchInputs, resolveCellOptions } from "vitest-agent-ui";

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
