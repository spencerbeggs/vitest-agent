/**
 * Classifies a reduced {@link RenderState} into the two axes the
 * dispatcher reads: `RunShape` (single-test / single-file / single-project
 * / workspace) and `RunOutcome` (all-pass / some-fail / threshold-violation).
 *
 * Classification is pure and deterministic. The plugin runs it once per
 * end-of-run before invoking the dispatcher; Ink mode also classifies
 * once on `RunFinished` and reuses the result for the remainder of the
 * run (a mid-run shape change would be jarring — see UI rewrite spec
 * §7 open question 2).
 *
 * @packageDocumentation
 */

import type { ProjectSummary, RenderState, RunOutcome, RunShape } from "@vitest-agent/sdk";

/**
 * Compute the run shape from the reduced state plus the per-project
 * aggregates the plugin carries through {@link DispatchInputs.projects}.
 *
 * The classification follows the state-shape signal described in the
 * UI rewrite spec §7 open question 1:
 *
 * 1. More than one project → `workspace`.
 * 2. One module with exactly one test → `single-test`.
 * 3. One module with more than one test → `single-file`.
 * 4. Otherwise → `single-project`.
 */
export const classifyRunShape = (state: RenderState, projects: ReadonlyArray<ProjectSummary>): RunShape => {
	if (projects.length > 1) {
		return "workspace";
	}
	const moduleEntries = Object.values(state.modules);
	if (moduleEntries.length === 1) {
		const sole = moduleEntries[0];
		if (sole && sole.tests.length === 1) {
			return "single-test";
		}
		return "single-file";
	}
	return "single-project";
};

/**
 * Compute the outcome class from the reduced state.
 *
 * Precedence: failures win over threshold violations. A run with one
 * failing test and a coverage gap classifies as `some-fail`; the
 * threshold-violation cell is reserved for runs where the test suite
 * itself is clean but coverage policy is not.
 */
export const classifyOutcome = (state: RenderState): RunOutcome => {
	if (state.totals.failCount > 0) {
		return "some-fail";
	}
	if (state.coverage !== null && state.coverage.violations.length > 0) {
		return "threshold-violation";
	}
	return "all-pass";
};
