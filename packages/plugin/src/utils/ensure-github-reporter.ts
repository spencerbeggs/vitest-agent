/**
 * Ensure a Vitest `reporters` array contains a `github-actions` entry with
 * its markdown job summary disabled.
 *
 * @privateRemarks
 * Under Vitest 5 `github-actions` is seeded into `configDefaults.reporters`
 * whenever `GITHUB_ACTIONS=true`, and `resolveConfig` normalizes every bare
 * reporter name to a `[name, {}]` tuple. So by the time `configureVitest`
 * runs, the common CI case already holds `["github-actions", {}]` — an entry
 * that still writes a markdown job summary, because the reporter's own
 * default is `jobSummary.enabled = true`. The plugin writes its own step
 * summary to `$GITHUB_STEP_SUMMARY` under `env === "ci-github"`, so leaving
 * that entry alone produces two reports in the same job.
 *
 * This function therefore NORMALIZES an existing entry rather than only
 * appending a missing one: a bare string or a tuple whose options leave
 * `jobSummary.enabled` unset becomes
 * `["github-actions", { jobSummary: { enabled: false } }]`, with every other
 * option preserved. The plugin owns the summary, the reporter owns the
 * `::error::` annotations. An explicit `jobSummary.enabled === true` is a
 * deliberate opt-in and is left untouched; the `GITHUB_JOB_SUMMARY_COLLISION`
 * ConfigValidation rule warns about that case instead.
 *
 * @internal
 */
export function ensureGithubActionsReporter(reporters: unknown[]): unknown[] {
	let found = false;
	const normalized = reporters.map((entry) => {
		if (entry === "github-actions") {
			found = true;
			return ["github-actions", { jobSummary: { enabled: false } }];
		}
		if (!Array.isArray(entry) || entry[0] !== "github-actions") {
			return entry;
		}
		found = true;
		const options = (entry[1] ?? {}) as { jobSummary?: { enabled?: boolean } };
		if (options.jobSummary?.enabled === true) {
			return entry;
		}
		return ["github-actions", { ...options, jobSummary: { ...options.jobSummary, enabled: false } }];
	});
	if (found) {
		return normalized;
	}
	return [...reporters, ["github-actions", { jobSummary: { enabled: false } }]];
}
