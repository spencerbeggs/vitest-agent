import type { SuggestedActionRecord } from "../schemas/RenderState.js";
import type { PostRunTiming, RunDiagnostics } from "../schemas/RunDiagnostics.js";

/**
 * Post-run work at or above this many milliseconds is always "slow".
 * @public
 */
export const POST_RUN_SLOW_MS = 5000;

/**
 * Post-run work at or above this share of Vitest's own duration is "slow"
 * (once it also clears {@link POST_RUN_SLOW_MIN_MS}).
 * @public
 */
export const POST_RUN_SLOW_SHARE = 0.1;

/**
 * Minimum post-run milliseconds before the share rule applies.
 * @public
 */
export const POST_RUN_SLOW_MIN_MS = 1000;

/**
 * Whether the plugin's post-run work was slow enough to surface.
 * @public
 */
export function isPostRunSlow(timing: PostRunTiming): boolean {
	if (timing.totalMs >= POST_RUN_SLOW_MS) return true;
	return (
		timing.totalMs >= POST_RUN_SLOW_MIN_MS &&
		timing.vitestDurationMs !== undefined &&
		timing.totalMs >= POST_RUN_SLOW_SHARE * timing.vitestDurationMs
	);
}

const fmt = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * Map run diagnostics onto suggested actions: persistence failure first, then
 * slow post-run work, then performance hints in input order.
 * @public
 */
export function suggestedActionsFromRunDiagnostics(d: RunDiagnostics): ReadonlyArray<SuggestedActionRecord> {
	const out: SuggestedActionRecord[] = [];

	if (d.persistence !== undefined && !d.persistence.ok) {
		const { reason, migrationFailed } = d.persistence;
		out.push({
			severity: "warn",
			title: "Results were not saved",
			detail: migrationFailed
				? `${reason}. Run \`vitest-agent db reset\` to recreate the database.`
				: (reason ?? "unknown error"),
		});
	}

	if (d.postRun !== undefined && isPostRunSlow(d.postRun)) {
		const { totalMs, persistMs, coverageScanMs } = d.postRun;
		out.push({
			severity: "warn",
			title: `Post-run work took ${fmt(totalMs)} (persist ${fmt(persistMs)}, coverage scan ${fmt(coverageScanMs)})`,
			detail:
				"Time vitest-agent spent after Vitest finished. Set persist: false where history is not needed (e.g. CI), or narrow coverage.include.",
		});
	}

	for (const hint of d.performanceHints) {
		out.push({
			severity: "info",
			title: hint.project !== undefined ? `${hint.project}: ${hint.message}` : hint.message,
			detail: `${hint.remedy} — ${hint.detail} (${hint.learnMoreUrl})`,
		});
	}

	return out;
}
