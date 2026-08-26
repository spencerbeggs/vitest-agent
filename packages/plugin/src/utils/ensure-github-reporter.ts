/**
 * Ensure a Vitest `reporters` array contains a `github-actions` entry.
 *
 * @privateRemarks
 * Vitest only auto-appends its built-in `"github-actions"` reporter when
 * the resolved `reporters` array is EMPTY. Once any other reporter is
 * configured (which the plugin always does), that implicit behavior no
 * longer applies, so `AgentPlugin` calls this explicitly under
 * `env === "ci-github"` to guarantee the entry is present.
 *
 * @internal
 */
export function ensureGithubActionsReporter(reporters: unknown[]): unknown[] {
	const hasGithubActions = reporters.some((entry) => {
		if (typeof entry === "string") {
			return entry === "github-actions";
		}
		if (Array.isArray(entry) && typeof entry[0] === "string") {
			return entry[0] === "github-actions";
		}
		return false;
	});
	if (hasGithubActions) {
		return reporters;
	}
	return [...reporters, ["github-actions", {}]];
}
