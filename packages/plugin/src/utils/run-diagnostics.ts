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
import { isPostRunSlow } from "@vitest-agent/sdk";

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
 * Whether diagnostics carry nothing worth surfacing: no performance hints, no
 * persistence failure, and post-run work that was not slow.
 *
 * @internal
 */
export const isEmptyRunDiagnostics = (d: RunDiagnostics): boolean =>
	d.performanceHints.length === 0 &&
	(d.persistence === undefined || d.persistence.ok) &&
	(d.postRun === undefined || !isPostRunSlow(d.postRun));

/**
 * Publish the run's diagnostics on the Vitest instance for readers in the
 * same process (the MCP `run_tests` tool). `undefined` or empty diagnostics
 * clear the slot so a watch-mode rerun never reports a stale diagnostic.
 *
 * @internal
 */
export const publishRunDiagnostics = (vitest: object, d: RunDiagnostics | undefined): void => {
	(vitest as Record<symbol, unknown>)[RUN_DIAGNOSTICS_SYMBOL] =
		d === undefined || isEmptyRunDiagnostics(d) ? undefined : d;
};
