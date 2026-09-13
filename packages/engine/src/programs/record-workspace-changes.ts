// Lib function for the `record run-workspace-changes` CLI subcommand.
//
// Driven by the PostToolUse hook on `git commit` / `git push`. Writes a
// commits row (idempotent on sha via ON CONFLICT DO NOTHING in
// DataStore.writeCommit) and zero or more run_changed_files rows.
//
// Optionally associates the changed files with a test_run_id; for the
// commit-side write path we don't have a run, so we associate the files
// with the most-recent test_run for the project (best-effort) or skip
// the file rows entirely if no test_run exists yet.

import type { DataStoreError } from "@vitest-agent/sdk";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { ChangeKind } from "../services/DataStore.js";
import { DataStore } from "../services/DataStore.js";

/**
 * Input for {@link recordRunWorkspaceChangesEffect}: one commit plus the
 * files it touched.
 *
 * @public
 */
export interface RecordWorkspaceChangesInput {
	/** Commit sha; the `commits` row is idempotent on it. */
	readonly sha: string;
	/** Parent commit sha, when known. */
	readonly parentSha?: string;
	/** Commit message. */
	readonly message?: string;
	/** Commit author. */
	readonly author?: string;
	/** ISO-8601 commit timestamp. */
	readonly committedAt?: string;
	/** Branch the commit landed on. */
	readonly branch?: string;
	/** When provided, scope the most-recent-run lookup to this project. */
	readonly project?: string;
	/** Files changed by the commit, each with its change kind. */
	readonly files: ReadonlyArray<{
		readonly filePath: string;
		readonly changeKind: ChangeKind;
	}>;
}

/**
 * Result of a workspace-changes write.
 *
 * @public
 */
export interface RecordWorkspaceChangesResult {
	/** The commit sha that was recorded. */
	readonly sha: string;
	/** Number of `run_changed_files` rows written (0 when no test run exists yet). */
	readonly fileRowsWritten: number;
}

/**
 * `ProjectRunSummary` doesn't expose `lastRunId`, so we query it directly
 * via SqlClient. This is the run id of the most-recent test run for a
 * given project (or any project, when `project` is unspecified). Used
 * only as a best-effort association target for `run_changed_files`.
 */
const findLatestRunId = (project: string | undefined): Effect.Effect<number | null, DataStoreError, SqlClient> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const rows =
			project !== undefined
				? yield* sql<{ id: number }>`
						SELECT id FROM test_runs
						WHERE project = ${project}
						ORDER BY timestamp DESC LIMIT 1
					`
				: yield* sql<{ id: number }>`
						SELECT id FROM test_runs
						ORDER BY timestamp DESC LIMIT 1
					`;
		return rows.length === 0 ? null : rows[0].id;
	}).pipe(Effect.orElseSucceed(() => null));

/**
 * Record a commit and, best-effort, associate its changed files with the
 * most recent test run for the project.
 *
 * @param input - the commit and its changed files
 * @public
 */
export const recordRunWorkspaceChangesEffect = (
	input: RecordWorkspaceChangesInput,
): Effect.Effect<RecordWorkspaceChangesResult, DataStoreError, DataStore | SqlClient> =>
	Effect.gen(function* () {
		const store = yield* DataStore;

		yield* store.writeCommit({
			sha: input.sha,
			...(input.parentSha !== undefined && { parentSha: input.parentSha }),
			...(input.message !== undefined && { message: input.message }),
			...(input.author !== undefined && { author: input.author }),
			...(input.committedAt !== undefined && { committedAt: input.committedAt }),
			...(input.branch !== undefined && { branch: input.branch }),
		});

		// Best-effort run association: pick the most-recent run id for the
		// project (or any project when unspecified). If no run exists yet,
		// the commit still lands but file rows are skipped.
		const runId = yield* findLatestRunId(input.project);

		if (runId !== null && input.files.length > 0) {
			yield* store.writeRunChangedFiles({
				runId,
				files: input.files.map((f) => ({
					filePath: f.filePath,
					changeKind: f.changeKind,
					commitSha: input.sha,
				})),
			});
		}

		return {
			sha: input.sha,
			fileRowsWritten: runId !== null ? input.files.length : 0,
		};
	});
