// Post-2.0 incremental migration (issue 623: a retention policy for data.db).
//
// `DataStore.pruneRuns` deletes `test_runs` rows and lets the schema's
// cascades remove the dependent rows. Two things in `0001_initial` stood in
// the way:
//
//   - `test_history.run_id` was `NOT NULL ... ON DELETE CASCADE`, so pruning
//     a run would also delete the history rows classification reads
//     (`stable` / `new-failure` / `persistent` / `flaky` / `recovered`).
//     History has its own retention (the newest 10 rows per series), so it
//     must survive the run that wrote it. SQLite cannot alter a foreign
//     key in place: the table is rebuilt with `run_id` nullable and
//     `ON DELETE SET NULL`, every row copied across, and its three indexes
//     recreated. `test_history` has live readers and writers, so this is
//     the ALTER-and-preserve path, never a drop.
//   - Several child foreign-key columns had no index. SQLite checks every
//     child table when a parent row is deleted (and walks it for CASCADE /
//     SET NULL), so an unindexed child column turns each deleted run, case
//     or file into a full table scan. Every child column a run prune or the
//     `files` garbage collection reaches is indexed here, plus
//     `test_runs(project, timestamp)` for the newest-N-per-project ranking.

import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;

	// --- test_history: run_id nullable, SET NULL when its run is pruned ---
	yield* sql`
		CREATE TABLE test_history_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER REFERENCES test_runs(id) ON DELETE SET NULL,
			project TEXT NOT NULL,
			module_path TEXT NOT NULL,
			full_name TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('passed', 'failed', 'skipped', 'pending')),
			duration INTEGER,
			flaky INTEGER CHECK (flaky IN (0, 1)),
			retry_count INTEGER DEFAULT 0,
			error_message TEXT,
			UNIQUE(project, module_path, full_name, timestamp)
		)
	`;
	yield* sql`
		INSERT INTO test_history_new (id, run_id, project, module_path, full_name, timestamp, state, duration, flaky, retry_count, error_message)
		SELECT id, run_id, project, module_path, full_name, timestamp, state, duration, flaky, retry_count, error_message
		FROM test_history
	`;
	yield* sql`DROP INDEX IF EXISTS idx_test_history_lookup`;
	yield* sql`DROP INDEX IF EXISTS idx_test_history_full_name`;
	yield* sql`DROP INDEX IF EXISTS idx_test_history_run`;
	yield* sql`DROP TABLE test_history`;
	yield* sql`ALTER TABLE test_history_new RENAME TO test_history`;
	yield* sql`CREATE INDEX idx_test_history_lookup ON test_history(project, module_path, full_name)`;
	yield* sql`CREATE INDEX idx_test_history_full_name ON test_history(full_name, timestamp)`;
	yield* sql`CREATE INDEX idx_test_history_run ON test_history(run_id)`;

	// --- the newest-N-per-project ranking ---
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_runs_project_timestamp ON test_runs(project, timestamp)`;

	// --- child columns referencing files(id), for the orphan-file GC ---
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_modules_file ON test_modules(file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_scoped_files_file ON scoped_files(file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_stack_frames_file ON stack_frames(file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_annotations_file ON test_annotations(location_file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_artifacts_file ON test_artifacts(location_file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_import_durations_file ON import_durations(file_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_tdd_artifacts_file ON tdd_artifacts(file_id)`;

	// --- child columns referencing test_runs(id) ---
	yield* sql`CREATE INDEX IF NOT EXISTS idx_tdd_artifacts_test_run ON tdd_artifacts(test_run_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_tdd_artifacts_first_failure_run ON tdd_artifacts(test_first_failure_run_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_failure_signatures_first_seen_run ON failure_signatures(first_seen_run_id)`;

	// --- child columns reached through the module -> suite -> case cascade ---
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_suites_parent ON test_suites(parent_suite_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_errors_suite ON test_errors(test_suite_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_errors_module ON test_errors(module_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_test_errors_cause ON test_errors(cause_error_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_tdd_artifacts_test_case ON tdd_artifacts(test_case_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_task_metadata_case ON task_metadata(test_case_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_task_metadata_suite ON task_metadata(test_suite_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_task_metadata_module ON task_metadata(module_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hook_executions_module ON hook_executions(test_module_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hook_executions_suite ON hook_executions(test_suite_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hook_executions_case ON hook_executions(test_case_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hook_executions_error ON hook_executions(error_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_attachments_artifact ON attachments(artifact_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_attachments_annotation ON attachments(annotation_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hypotheses_cited_error ON hypotheses(cited_test_error_id)`;
	yield* sql`CREATE INDEX IF NOT EXISTS idx_hypotheses_cited_frame ON hypotheses(cited_stack_frame_id)`;
});

/** @public */
export default migration;
