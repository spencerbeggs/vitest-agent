/**
 * Classifies a reduced `RenderState` into the two axes the
 * dispatcher reads: `RunShape` (single-test / single-file / single-project
 * / workspace) and `RunOutcome` (all-pass / some-fail / threshold-violation).
 *
 * Classification is pure and deterministic. The plugin runs it once per
 * end-of-run before invoking the dispatcher; Ink mode also classifies
 * once on `RunFinished` and reuses the result for the remainder of the
 * run (a mid-run shape change would be jarring — see UI rewrite spec
 * §7 open question 2).
 */

import type { ProjectSummary, RenderState, RunOutcome, RunShape } from "@vitest-agent/sdk";

/**
 * Compute the run shape from the reduced state plus the per-project
 * aggregates the plugin carries through `DispatchInputs.projects`.
 *
 * The classification follows the state-shape signal described in the
 * UI rewrite spec §7 open question 1:
 *
 * 1. More than one project → `workspace`.
 * 2. One module with exactly one test → `single-test`.
 * 3. One module with more than one test → `single-file`.
 * 4. Otherwise → `single-project`.
 *
 * @param state - the fully-reduced render state
 * @param projects - per-project summaries from the dispatch inputs
 * @returns the run shape classification
 * @public
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
 * Precedence: failures win over timeouts, and both win over threshold
 * violations. A run with one failing test and a coverage gap classifies
 * as `some-fail`; the threshold-violation cell is reserved for runs
 * where the test suite itself is clean but coverage policy is not. A
 * run whose only non-passing signal is one or more timed-out tests
 * (`totals.timeoutCount > 0`, `totals.failCount === 0`) also
 * classifies as `some-fail` — timeouts are not passes, and must not
 * route to a passing cell (issue #224). A run whose only non-passing
 * signal is a process-level unhandled error (`unhandledErrors.length
 * > 0`, all counts otherwise clean) also classifies as `some-fail` —
 * a green-looking count must never hide an unhandled error behind an
 * all-pass cell (issue #240).
 *
 * @param state - the fully-reduced render state
 * @returns the outcome classification
 * @public
 */
export const classifyOutcome = (state: RenderState): RunOutcome => {
	if (state.totals.failCount > 0) {
		return "some-fail";
	}
	if (state.unhandledErrors.length > 0) {
		return "some-fail";
	}
	if (state.totals.timeoutCount > 0) {
		return "some-fail";
	}
	if (state.coverage !== null && state.coverage.violations.length > 0) {
		return "threshold-violation";
	}
	return "all-pass";
};
