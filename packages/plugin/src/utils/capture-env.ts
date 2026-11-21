import { RuntimeEnv } from "@effected/env";
import { Option } from "effect";

const ALWAYS_CAPTURE = ["CI", "NODE_ENV", "VITEST_MODE"] as const;

/**
 * The GitHub Actions run coordinates that are kept, named by the variable each
 * one is read from. A fixed list, never a `GITHUB_*` / `RUNNER_*` prefix sweep:
 * a workflow can export a secret (`GITHUB_TOKEN`, a `GITHUB_*` deploy key) into
 * the environment, and these values are persisted to `data.db` and served by
 * the MCP `configure` tool.
 *
 * @internal
 */
export const CAPTURED_CI_KEYS = [
	"GITHUB_ACTIONS",
	"GITHUB_RUN_ID",
	"GITHUB_RUN_ATTEMPT",
	"GITHUB_JOB",
	"GITHUB_SHA",
	"GITHUB_REF_NAME",
	"RUNNER_OS",
	"RUNNER_ARCH",
] as const;

/**
 * Capture CI and GitHub Actions environment variables for persistence.
 *
 * Under GitHub Actions the run's coordinates come from `@effected/env`'s
 * `RuntimeEnv.ciRun` (run id, attempt, job, commit, short ref, runner OS and
 * architecture) and are recorded under the variable names they were read from.
 * No other `GITHUB_*` or `RUNNER_*` variable is captured.
 *
 * @param env - The process environment record to read from
 * @returns A filtered map of relevant environment variable keys and values
 * @public
 */
export function captureEnvVars(env: Record<string, string | undefined>): Record<string, string> {
	const result: Record<string, string> = {};

	for (const key of ALWAYS_CAPTURE) {
		const value = env[key];
		if (value !== undefined) result[key] = value;
	}

	const runtimeEnv = RuntimeEnv.fromRecord(env);
	if (!Option.contains(runtimeEnv.ci, "github-actions")) return result;

	const put = (key: (typeof CAPTURED_CI_KEYS)[number], value: Option.Option<string>): void => {
		if (Option.isSome(value)) result[key] = value.value;
	};
	put("GITHUB_ACTIONS", Option.fromNullishOr(env.GITHUB_ACTIONS));
	const ciRun = runtimeEnv.ciRun;
	if (Option.isSome(ciRun)) {
		const run = ciRun.value;
		put("GITHUB_RUN_ID", run.runId);
		put("GITHUB_RUN_ATTEMPT", run.attempt);
		put("GITHUB_JOB", run.jobId);
		put("GITHUB_SHA", run.sha);
		put("GITHUB_REF_NAME", run.refName);
		put(
			"RUNNER_OS",
			Option.map(run.runner, (r) => r.os),
		);
		put(
			"RUNNER_ARCH",
			Option.flatMap(run.runner, (r) => r.arch),
		);
	}

	return result;
}
