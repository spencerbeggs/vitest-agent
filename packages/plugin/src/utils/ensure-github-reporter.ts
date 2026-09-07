/**
 * Ensure a Vitest `reporters` array contains a `github-actions` entry with
 * its markdown job summary disabled.
 *
 * @privateRemarks
 * Under Vitest 5 the `github-actions` reporter sits in `configDefaults.reporters`
 * unconditionally whenever `GITHUB_ACTIONS=true`, and it writes a markdown job
 * summary by default (`jobSummary.enabled = true`). The plugin writes its own
 * step summary to `$GITHUB_STEP_SUMMARY` under `env === "ci-github"`, so an
 * enabled job summary produces two reports in the same job. This function
 * therefore injects `{ jobSummary: { enabled: false } }` — the plugin owns the
 * summary, the reporter owns the `::error::` annotations. An entry the user
 * configured themselves is left untouched; the `GITHUB_JOB_SUMMARY_COLLISION`
 * ConfigValidation rule warns about that case instead.
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
	return [...reporters, ["github-actions", { jobSummary: { enabled: false } }]];
}
