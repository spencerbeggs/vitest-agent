/** @public */
export interface HostMetadataResult {
	readonly source: string | null;
	readonly value: string | null;
	readonly metadata: Record<string, unknown> | null;
}

const isUseful = (value: string | undefined): value is string => value !== undefined && value.length > 0;

/**
 * Walk the priority chain of env-var probes. Returns the first match
 * along with any decorating metadata (`term_program`, `ci_provider`,
 * etc.) for that source. When no probe matches, `source`/`value`/
 * `metadata` are all `null`.
 *
 * The probe order matches the plan's table exactly:
 *
 * 1. `TMUX_PANE` (tmux reattach-stable)
 * 2. `WT_SESSION` (Windows Terminal pane)
 * 3. `WEZTERM_PANE` (WezTerm pane)
 * 4. `KITTY_WINDOW_ID` (kitty window)
 * 5. `TERM_SESSION_ID` (iTerm2, Terminal.app)
 * 6. `VSCODE_INJECTION` + `process.ppid` (handled by the Live layer
 *    since it needs `process.ppid`, not env)
 * 7. `GITHUB_RUN_ID` + `GITHUB_RUN_ATTEMPT`
 * 8. `BUILDKITE_JOB_ID` / `CIRCLE_BUILD_NUM` / `GITLAB_CI_JOB_ID`
 * 9. `process.ppid` walk (handled by the Live layer)
 * @public
 */
export const probeHostMetadataFromEnv = (env: Record<string, string | undefined>): HostMetadataResult => {
	const decoration = (extra: Record<string, unknown>): Record<string, unknown> => {
		const baseDecoration: Record<string, unknown> = {};
		if (isUseful(env.TERM_PROGRAM)) baseDecoration.term_program = env.TERM_PROGRAM;
		if (isUseful(env.TERM_PROGRAM_VERSION)) baseDecoration.term_program_version = env.TERM_PROGRAM_VERSION;
		return { ...baseDecoration, ...extra };
	};

	if (isUseful(env.TMUX_PANE)) {
		return {
			source: "TMUX_PANE",
			value: env.TMUX_PANE,
			metadata: decoration(isUseful(env.TMUX) ? { tmux_socket: env.TMUX } : {}),
		};
	}

	if (isUseful(env.WT_SESSION)) {
		return { source: "WT_SESSION", value: env.WT_SESSION, metadata: decoration({}) };
	}

	if (isUseful(env.WEZTERM_PANE)) {
		return { source: "WEZTERM_PANE", value: env.WEZTERM_PANE, metadata: decoration({}) };
	}

	if (isUseful(env.KITTY_WINDOW_ID)) {
		return { source: "KITTY_WINDOW_ID", value: env.KITTY_WINDOW_ID, metadata: decoration({}) };
	}

	if (isUseful(env.TERM_SESSION_ID)) {
		return { source: "TERM_SESSION_ID", value: env.TERM_SESSION_ID, metadata: decoration({}) };
	}

	if (isUseful(env.GITHUB_RUN_ID)) {
		return {
			source: "GITHUB_RUN_ID",
			value: env.GITHUB_RUN_ID,
			metadata: decoration({
				ci: true,
				ci_provider: "github",
				...(isUseful(env.GITHUB_RUN_ATTEMPT) ? { github_run_attempt: env.GITHUB_RUN_ATTEMPT } : {}),
			}),
		};
	}

	if (isUseful(env.BUILDKITE_JOB_ID)) {
		return {
			source: "BUILDKITE_JOB_ID",
			value: env.BUILDKITE_JOB_ID,
			metadata: decoration({ ci: true, ci_provider: "buildkite" }),
		};
	}

	if (isUseful(env.CIRCLE_BUILD_NUM)) {
		return {
			source: "CIRCLE_BUILD_NUM",
			value: env.CIRCLE_BUILD_NUM,
			metadata: decoration({ ci: true, ci_provider: "circle" }),
		};
	}

	if (isUseful(env.GITLAB_CI_JOB_ID)) {
		return {
			source: "GITLAB_CI_JOB_ID",
			value: env.GITLAB_CI_JOB_ID,
			metadata: decoration({ ci: true, ci_provider: "gitlab" }),
		};
	}

	return { source: null, value: null, metadata: null };
};
