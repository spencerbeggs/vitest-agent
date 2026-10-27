import type { CiName } from "@effected/env";
import { RuntimeEnv } from "@effected/env";
import { Option } from "effect";

/**
 * The host identity a test run records: `host_source` / `host_value` /
 * `host_metadata` on `test_runs`.
 *
 * @public
 */
export interface HostMetadataResult {
	readonly source: string | null;
	readonly value: string | null;
	readonly metadata: Record<string, unknown> | null;
}

/**
 * The `ci_provider` string persisted for each CI whose job coordinate is
 * recorded. These are this project's own spellings (`github`, `circle`),
 * stored since 2.0; they are mapped from `CiName` rather than replaced by it
 * so existing rows keep matching.
 */
const CI_ROWS: Partial<
	Record<
		CiName,
		{
			readonly provider: string;
			readonly variable: string;
			readonly coordinate: "runId" | "jobId";
		}
	>
> = {
	"github-actions": { provider: "github", variable: "GITHUB_RUN_ID", coordinate: "runId" },
	buildkite: { provider: "buildkite", variable: "BUILDKITE_JOB_ID", coordinate: "jobId" },
	// `CIRCLE_BUILD_NUM` is the kit's `jobId`; its `runId` is `CIRCLE_WORKFLOW_ID`.
	circleci: { provider: "circle", variable: "CIRCLE_BUILD_NUM", coordinate: "jobId" },
	// GitLab's job id is `CI_JOB_ID`. Before the kit, this probe read
	// `GITLAB_CI_JOB_ID`, which GitLab never sets, so GitLab rows are new.
	gitlab: { provider: "gitlab", variable: "CI_JOB_ID", coordinate: "jobId" },
};

const NONE: HostMetadataResult = { source: null, value: null, metadata: null };

/**
 * The host identity of an environment record, from `@effected/env`'s
 * `RuntimeEnv` snapshot (`session`, `ci` / `ciRun`, `termProgram`).
 *
 * Priority: the terminal session (`TMUX_PANE`, `WT_SESSION`, `WEZTERM_PANE`,
 * `KITTY_WINDOW_ID`, `TERM_SESSION_ID`), then the CI job (GitHub Actions run,
 * Buildkite, CircleCI, GitLab job). The first match is the source; when
 * nothing matches, all three fields are `null`. Every metadata object
 * carries `term_program` / `term_program_version` when they are set, then
 * the source's own keys (`tmux_socket` for a tmux pane, `ci`, `ci_provider`
 * and `github_run_attempt` for CI), in that key order.
 *
 * GNU screen (`STY`) is not a source: the snapshot is taken with `STY`
 * removed, so a screen session falls through to the next source exactly as
 * it did before the kit, and no `STY` row is ever written. The
 * `VSCODE_INJECTION` + parent-pid sources need `process.ppid` and are the
 * caller's.
 *
 * @param env - the environment record to read (the front end passes `process.env`)
 * @public
 */
export const probeHostMetadataFromEnv = (env: Readonly<Record<string, string | undefined>>): HostMetadataResult => {
	const snapshot = RuntimeEnv.fromRecord({ ...env, STY: undefined });

	const decoration = (extra: Record<string, unknown>): Record<string, unknown> => ({
		...Option.match(snapshot.termProgram.name, { onNone: () => ({}), onSome: (name) => ({ term_program: name }) }),
		...Option.match(snapshot.termProgram.version, {
			onNone: () => ({}),
			onSome: (version) => ({ term_program_version: version }),
		}),
		...extra,
	});

	if (Option.isSome(snapshot.session)) {
		const session = snapshot.session.value;
		const socket =
			session.source === "tmux"
				? Option.filter(session.multiplexer, (multiplexer) => multiplexer.name === "tmux")
				: Option.none();
		return {
			source: session.variable,
			value: session.id,
			metadata: decoration(Option.isSome(socket) ? { tmux_socket: socket.value.value } : {}),
		};
	}

	if (Option.isNone(snapshot.ci) || Option.isNone(snapshot.ciRun)) return NONE;
	const row = CI_ROWS[snapshot.ci.value];
	if (row === undefined) return NONE;
	const run = snapshot.ciRun.value;
	const value = run[row.coordinate];
	if (Option.isNone(value)) return NONE;
	return {
		source: row.variable,
		value: value.value,
		metadata: decoration({
			ci: true,
			ci_provider: row.provider,
			...(row.provider === "github" && Option.isSome(run.attempt) ? { github_run_attempt: run.attempt.value } : {}),
		}),
	};
};
