/**
 * The one per-project projection every text surface renders from.
 *
 * `summarizeProject` turns an `AgentReport` into the `ProjectSummary` the
 * dispatcher cells, the GitHub step-summary totals table and the
 * `::group::` log block all read, so no two surfaces can disagree about a
 * project's counts. That matters most for timeouts: `summary.failed` folds a
 * timed-out test in as a plain failure, while every rendered surface reports
 * it in its own `timed out` slot (issue #545).
 *
 * @internal
 */

import type { AgentReport, ProjectSummary } from "@vitest-agent/sdk";
import { countSuiteFailures, isTimeoutError } from "@vitest-agent/sdk";

/** Timed-out tests in `report.failed[].tests[]`, identified per test by `isTimeoutError`. */
export const countTimeouts = (report: AgentReport): number => {
	let timeoutCount = 0;
	for (const mod of report.failed) {
		for (const test of mod.tests) {
			const firstError = test.errors?.[0];
			if (test.state === "failed" && firstError !== undefined && isTimeoutError({ message: firstError.message })) {
				timeoutCount++;
			}
		}
	}
	return timeoutCount;
};

const collapseTagCounts = (entries: AgentReport["tagCounts"]): Record<string, number> => {
	const out: Record<string, number> = {};
	if (entries === undefined) return out;
	for (const [tag, entry] of Object.entries(entries)) {
		const total = (entry.passed ?? 0) + (entry.failed ?? 0) + (entry.skipped ?? 0);
		if (total > 0) out[tag] = total;
	}
	return out;
};

export const summarizeProject = (report: AgentReport): ProjectSummary => {
	const collapsedTagCounts = report.tagCounts !== undefined ? collapseTagCounts(report.tagCounts) : undefined;
	const tagCountsHasEntries = collapsedTagCounts !== undefined && Object.keys(collapsedTagCounts).length > 0;
	const belowTargetCount = report.coverage?.belowTargetFiles?.length;
	const violationsCount =
		report.coverage !== undefined && report.coverage.lowCoverage.length > 0
			? report.coverage.lowCoverage.length
			: undefined;
	// A timed-out test is identifiable per test in report.failed[].tests[]
	// via isTimeoutError; count it once, as a timeout, and subtract it
	// from failCount so it isn't double-counted as a plain failure
	// (matching the reducer's split in @vitest-agent/ui, issue #242).
	const timeoutCount = countTimeouts(report);
	return {
		name: report.project ?? "default",
		passCount: report.summary.passed,
		// summary.failed counts failed test cases only; add suite-level
		// (collection/load) failures so a file that never loaded turns the
		// project row red instead of showing a misleading all-green pass.
		failCount: report.summary.failed + countSuiteFailures(report) - timeoutCount,
		skipCount: report.summary.skipped,
		durationMs: report.summary.duration,
		...(timeoutCount > 0 ? { timeoutCount } : {}),
		...(tagCountsHasEntries && collapsedTagCounts !== undefined ? { tagCounts: collapsedTagCounts } : {}),
		...(belowTargetCount !== undefined ? { belowTarget: belowTargetCount } : {}),
		...(violationsCount !== undefined ? { violations: violationsCount } : {}),
	};
};
