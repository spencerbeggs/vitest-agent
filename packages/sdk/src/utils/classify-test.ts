import type { TestClassification } from "../schemas/Common.js";

/**
 * Classify a test based on its current state and prior run history.
 *
 * @param current - The test's state in the current run
 * @param priorRuns - Previous runs (most recent first), before the current run was prepended
 * @returns The test's classification
 * @public
 */
export function classifyTest(
	current: "passed" | "failed",
	priorRuns: ReadonlyArray<{ state: string }>,
): TestClassification {
	if (current === "failed") {
		if (priorRuns.length === 0) return "new-failure";
		const allPriorPassed = priorRuns.every((r) => r.state === "passed");
		if (allPriorPassed) return "new-failure";
		if (priorRuns[0].state === "failed") return "persistent";
		return "flaky";
	}
	// current === "passed"
	if (priorRuns.length === 0) return "stable";
	const anyPriorFailed = priorRuns.some((r) => r.state === "failed");
	return anyPriorFailed ? "recovered" : "stable";
}
