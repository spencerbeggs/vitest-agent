/**
 * Publish the run's diagnostics on the Vitest instance (issue #544).
 *
 * `onTestRunEnd` assembles a `RunDiagnostics` (performance hints, post-run
 * timing, persistence status) and hands it to every reporter on
 * `ReporterRenderInput.runDiagnostics`. The MCP `run_tests` tool runs Vitest
 * in-process and shapes its own payload, so the plugin also stores the same
 * diagnostics on the Vitest instance under {@link RUN_DIAGNOSTICS_SYMBOL},
 * mirroring `publishConfigSuggestedActions`.
 *
 * @internal
 */

import type { RunDiagnostics } from "@vitest-agent/sdk";

/**
 * The `Symbol.for` key under which `onTestRunEnd` publishes the run's
 * diagnostics on the Vitest instance. `Symbol.for` resolves to the identical
 * symbol across module copies in one process, so the MCP `run_tests` tool
 * reads the same slot without importing the plugin.
 *
 * @internal
 */
export const RUN_DIAGNOSTICS_SYMBOL: unique symbol = Symbol.for("vitest-agent:run-diagnostics");

/**
 * Publish the run's diagnostics on the Vitest instance for readers in the
 * same process (the MCP `run_tests` tool). Any defined diagnostics are
 * published, so a clean run still carries its post-run timing and overwrites
 * the previous run's value; only `undefined` clears the slot, so a watch-mode
 * rerun never reports a stale diagnostic.
 *
 * @internal
 */
export const publishRunDiagnostics = (vitest: object, d: RunDiagnostics | undefined): void => {
	(vitest as Record<symbol, unknown>)[RUN_DIAGNOSTICS_SYMBOL] = d;
};
