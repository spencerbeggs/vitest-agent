/**
 * Format the informational note shown when coverage thresholds were
 * skipped because a run only exercised a subset of the project's test
 * files (issue #160). Vitest's coverage provider enforces
 * `coverage.thresholds` against the whole-project denominator
 * regardless of how many files actually ran, so callers that detect a
 * scoped/partial run suppress the native threshold check and surface
 * this note instead so the agent understands why no pass/fail verdict
 * was rendered for coverage.
 *
 * @param testedFileCount - number of test files that actually ran
 * @param totalFileCount - total number of test files in the project
 * @returns the note text, e.g. `"Coverage thresholds skipped: partial run (2 of 47 test files)"`
 * @public
 */
export function formatScopedCoverageNote(testedFileCount: number, totalFileCount: number): string {
	return `Coverage thresholds skipped: partial run (${testedFileCount} of ${totalFileCount} test files)`;
}
