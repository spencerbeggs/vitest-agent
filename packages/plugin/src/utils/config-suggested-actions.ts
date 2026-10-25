/**
 * Map `ConfigValidation` diagnostics onto the run's suggested actions.
 *
 * `configureVitest` runs `ConfigValidation` once per Vitest run and writes
 * every warning and info entry to stderr for a human. An agent reading the
 * rendered report, or the MCP `run_tests` payload, never sees stderr, so the
 * same diagnostics are also mapped here onto `SuggestedActionRecord`s that
 * ride `ReporterRenderInput.suggestedActions` into the `Actions:` trailer
 * (issue #544). Errors are not mapped: they throw before the run starts.
 *
 * Pure: no I/O, no Effect runtime. The plugin publishes the result on the
 * Vitest instance under {@link CONFIG_SUGGESTED_ACTIONS_SYMBOL} so the MCP
 * server, which runs Vitest in-process and shapes its own payload, can read
 * it back without importing the plugin.
 *
 * @internal
 */

import type { SuggestedActionRecord } from "@vitest-agent/sdk";
import type { ValidationResult } from "../services/ConfigValidation.js";

/**
 * The `Symbol.for` key under which `configureVitest` publishes the run's
 * config-derived suggested actions on the Vitest instance. `Symbol.for`
 * resolves to the identical symbol across module copies in one process, so
 * the MCP `run_tests` tool reads the same slot off the Vitest instance it
 * created (mirrors the discovery last-scan slot).
 *
 * @internal
 */
export const CONFIG_SUGGESTED_ACTIONS_SYMBOL: unique symbol = Symbol.for("vitest-agent:config-suggested-actions");

/**
 * Map a `ValidationResult`'s warnings and info entries onto suggested
 * actions, in the order the validator produced them. A warning becomes a
 * `warn` action and an info entry an `info` action; the title names the
 * rule code, the detail carries the message followed by the remediation
 * when the rule has one. No `targetTool` — there is no MCP tool that edits
 * the Vitest config.
 *
 * @internal
 */
export const suggestedActionsFromValidation = (result: ValidationResult): ReadonlyArray<SuggestedActionRecord> => [
	...result.warnings.map(
		(w): SuggestedActionRecord => ({
			severity: "warn",
			title: `Coverage config: ${w.code}`,
			detail: w.remediation !== undefined ? `${w.message} ${w.remediation}` : w.message,
		}),
	),
	...result.info.map(
		(i): SuggestedActionRecord => ({
			severity: "info",
			title: `Coverage config: ${i.code}`,
			detail: i.message,
		}),
	),
];

/**
 * Publish the run's config-derived suggested actions on the Vitest instance
 * for readers in the same process (the MCP `run_tests` tool). An empty list
 * clears the slot so a watch-mode rerun after a config fix reports nothing.
 *
 * @internal
 */
export const publishConfigSuggestedActions = (vitest: object, actions: ReadonlyArray<SuggestedActionRecord>): void => {
	(vitest as Record<symbol, unknown>)[CONFIG_SUGGESTED_ACTIONS_SYMBOL] = actions.length > 0 ? actions : undefined;
};
