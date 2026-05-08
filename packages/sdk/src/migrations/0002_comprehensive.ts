import { SqlClient } from "@effect/sql/SqlClient";
import { Effect } from "effect";

const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;

	// Drop all 1.x tables (last drop-and-recreate per Decision D9).
	// Order matters for FK-bearing tables: drop children before parents.
	// Drop FTS5 triggers before notes/notes_fts so DROP TABLE notes doesn't
	// fire triggers that reference the already-dropped notes_fts.
	yield* sql`DROP TRIGGER IF EXISTS notes_ai`;
	yield* sql`DROP TRIGGER IF EXISTS notes_ad`;
	yield* sql`DROP TRIGGER IF EXISTS notes_au`;
	yield* sql`DROP TRIGGER IF EXISTS notes_bu`;
	yield* sql`DROP TABLE IF EXISTS notes_fts`;
	yield* sql`DROP TABLE IF EXISTS notes`;
	yield* sql`DROP TABLE IF EXISTS source_test_map`;
	yield* sql`DROP TABLE IF EXISTS file_coverage`;
	yield* sql`DROP TABLE IF EXISTS coverage_trends`;
	yield* sql`DROP TABLE IF EXISTS coverage_baselines`;
	yield* sql`DROP TABLE IF EXISTS test_history`;
	yield* sql`DROP TABLE IF EXISTS console_logs`;
	yield* sql`DROP TABLE IF EXISTS task_metadata`;
	yield* sql`DROP TABLE IF EXISTS scoped_files`;
	yield* sql`DROP TABLE IF EXISTS import_durations`;
	yield* sql`DROP TABLE IF EXISTS attachments`;
	yield* sql`DROP TABLE IF EXISTS test_artifacts`;
	yield* sql`DROP TABLE IF EXISTS test_annotations`;
	yield* sql`DROP TABLE IF EXISTS test_suite_tags`;
	yield* sql`DROP TABLE IF EXISTS test_case_tags`;
	yield* sql`DROP TABLE IF EXISTS tags`;
	yield* sql`DROP TABLE IF EXISTS stack_frames`;
	yield* sql`DROP TABLE IF EXISTS test_errors`;
	yield* sql`DROP TABLE IF EXISTS test_cases`;
	yield* sql`DROP TABLE IF EXISTS test_suites`;
	yield* sql`DROP TABLE IF EXISTS test_modules`;
	yield* sql`DROP TABLE IF EXISTS test_runs`;
	yield* sql`DROP TABLE IF EXISTS settings_env_vars`;
	yield* sql`DROP TABLE IF EXISTS settings`;
	yield* sql`DROP TABLE IF EXISTS files`;

	// Pragmas (idempotent; keep WAL + FKs)
	yield* sql`PRAGMA journal_mode=WAL`;
	yield* sql`PRAGMA foreign_keys=ON`;

	// 1. files
	yield* sql`
		CREATE TABLE files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			path TEXT NOT NULL UNIQUE
		)
	`;

	// 2. settings
	yield* sql`
		CREATE TABLE settings (
			hash TEXT PRIMARY KEY,
			vitest_version TEXT NOT NULL,
			pool TEXT,
			environment TEXT,
			test_timeout INTEGER,
			hook_timeout INTEGER,
			slow_test_threshold INTEGER,
			max_concurrency INTEGER,
			max_workers INTEGER,
			isolate INTEGER CHECK (isolate IN (0, 1)),
			bail INTEGER,
			globals INTEGER CHECK (globals IN (0, 1)),
			file_parallelism INTEGER CHECK (file_parallelism IN (0, 1)),
			sequence_seed INTEGER,
			coverage_provider TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`;

	// 3. settings_env_vars
	yield* sql`
		CREATE TABLE settings_env_vars (
			settings_hash TEXT NOT NULL REFERENCES settings(hash) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (settings_hash, key)
		)
	`;

	// 4. test_runs
	yield* sql`
		CREATE TABLE test_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			invocation_id TEXT NOT NULL,
			project TEXT NOT NULL,
			settings_hash TEXT NOT NULL REFERENCES settings(hash),
			timestamp TEXT NOT NULL,
			commit_sha TEXT,
			branch TEXT,
			reason TEXT NOT NULL CHECK (reason IN ('passed', 'failed', 'interrupted')),
			duration INTEGER NOT NULL,
			total INTEGER NOT NULL,
			passed INTEGER NOT NULL,
			failed INTEGER NOT NULL,
			skipped INTEGER NOT NULL,
			scoped INTEGER NOT NULL DEFAULT 0 CHECK (scoped IN (0, 1)),
			snapshot_added INTEGER DEFAULT 0,
			snapshot_matched INTEGER DEFAULT 0,
			snapshot_unmatched INTEGER DEFAULT 0,
			snapshot_updated INTEGER DEFAULT 0,
			snapshot_unchecked INTEGER DEFAULT 0,
			snapshot_total INTEGER DEFAULT 0,
			snapshot_failure INTEGER DEFAULT 0 CHECK (snapshot_failure IN (0, 1)),
			snapshot_did_update INTEGER DEFAULT 0 CHECK (snapshot_did_update IN (0, 1)),
			snapshot_files_added INTEGER DEFAULT 0,
			snapshot_files_removed INTEGER DEFAULT 0,
			snapshot_files_unmatched INTEGER DEFAULT 0,
			snapshot_files_updated INTEGER DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`;
	yield* sql`CREATE INDEX idx_test_runs_project ON test_runs(project)`;
	yield* sql`CREATE INDEX idx_test_runs_timestamp ON test_runs(timestamp)`;
	yield* sql`CREATE INDEX idx_test_runs_invocation ON test_runs(invocation_id)`;
	yield* sql`CREATE INDEX idx_test_runs_settings ON test_runs(settings_hash, project)`;

	// 5. scoped_files
	yield* sql`
		CREATE TABLE scoped_files (
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id),
			PRIMARY KEY (run_id, file_id)
		)
	`;

	// 6. test_modules
	yield* sql`
		CREATE TABLE test_modules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id),
			relative_module_id TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN (
				'queued', 'pending', 'passed', 'failed', 'skipped'
			)),
			duration INTEGER,
			environment_setup_duration INTEGER,
			prepare_duration INTEGER,
			collect_duration INTEGER,
			setup_duration INTEGER,
			heap INTEGER,
			UNIQUE(run_id, file_id)
		)
	`;
	yield* sql`CREATE INDEX idx_test_modules_run ON test_modules(run_id)`;

	// 7. test_suites
	yield* sql`
		CREATE TABLE test_suites (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			module_id INTEGER NOT NULL REFERENCES test_modules(id) ON DELETE CASCADE,
			parent_suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			full_name TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('pending', 'passed', 'failed', 'skipped')),
			mode TEXT CHECK (mode IN ('run', 'only', 'skip', 'todo')),
			concurrent INTEGER CHECK (concurrent IN (0, 1)),
			shuffle INTEGER CHECK (shuffle IN (0, 1)),
			retry INTEGER,
			repeats INTEGER,
			location_line INTEGER,
			location_column INTEGER
		)
	`;
	yield* sql`CREATE INDEX idx_test_suites_module ON test_suites(module_id)`;

	// 8. test_cases
	yield* sql`
		CREATE TABLE test_cases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			module_id INTEGER NOT NULL REFERENCES test_modules(id) ON DELETE CASCADE,
			suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
			vitest_id TEXT,
			name TEXT NOT NULL,
			full_name TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('passed', 'failed', 'skipped', 'pending')),
			classification TEXT CHECK (classification IN (
				'stable', 'new-failure', 'persistent', 'flaky', 'recovered'
			)),
			duration INTEGER,
			start_time INTEGER,
			flaky INTEGER CHECK (flaky IN (0, 1)),
			slow INTEGER CHECK (slow IN (0, 1)),
			retry_count INTEGER DEFAULT 0,
			repeat_count INTEGER DEFAULT 0,
			heap INTEGER,
			mode TEXT CHECK (mode IN ('run', 'only', 'skip', 'todo')),
			each INTEGER CHECK (each IN (0, 1)),
			fails INTEGER CHECK (fails IN (0, 1)),
			concurrent INTEGER CHECK (concurrent IN (0, 1)),
			shuffle INTEGER CHECK (shuffle IN (0, 1)),
			timeout INTEGER,
			skip_note TEXT,
			location_line INTEGER,
			location_column INTEGER,
			created_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL
		)
	`;
	yield* sql`CREATE INDEX idx_test_cases_module ON test_cases(module_id)`;
	yield* sql`CREATE INDEX idx_test_cases_suite ON test_cases(suite_id)`;
	yield* sql`CREATE INDEX idx_test_cases_full_name ON test_cases(full_name)`;
	yield* sql`CREATE INDEX idx_test_cases_state ON test_cases(state)`;
	yield* sql`CREATE INDEX idx_test_cases_module_state ON test_cases(module_id, state)`;
	yield* sql`CREATE INDEX idx_test_cases_created_turn ON test_cases(created_turn_id)`;

	// 9. test_errors
	yield* sql`
		CREATE TABLE test_errors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
			test_suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
			module_id INTEGER REFERENCES test_modules(id) ON DELETE CASCADE,
			scope TEXT NOT NULL CHECK (scope IN ('test', 'suite', 'module', 'unhandled')),
			name TEXT,
			message TEXT NOT NULL,
			diff TEXT,
			actual TEXT,
			expected TEXT,
			stack TEXT,
			cause_error_id INTEGER REFERENCES test_errors(id),
			ordinal INTEGER NOT NULL DEFAULT 0
		)
	`;
	yield* sql`CREATE INDEX idx_test_errors_run ON test_errors(run_id)`;
	yield* sql`CREATE INDEX idx_test_errors_case ON test_errors(test_case_id)`;
	yield* sql`CREATE INDEX idx_test_errors_name ON test_errors(name)`;
	yield* sql`CREATE INDEX idx_test_errors_scope ON test_errors(run_id, scope)`;

	// 10. stack_frames
	yield* sql`
		CREATE TABLE stack_frames (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			error_id INTEGER NOT NULL REFERENCES test_errors(id) ON DELETE CASCADE,
			ordinal INTEGER NOT NULL,
			method TEXT,
			file_id INTEGER REFERENCES files(id),
			line INTEGER,
			col INTEGER
		)
	`;
	yield* sql`CREATE INDEX idx_stack_frames_error ON stack_frames(error_id)`;

	// 11. tags
	yield* sql`
		CREATE TABLE tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE
		)
	`;

	// 12. test_case_tags
	yield* sql`
		CREATE TABLE test_case_tags (
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (test_case_id, tag_id)
		)
	`;

	// 13. test_suite_tags
	yield* sql`
		CREATE TABLE test_suite_tags (
			test_suite_id INTEGER NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
			tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (test_suite_id, tag_id)
		)
	`;

	// 14. test_annotations
	yield* sql`
		CREATE TABLE test_annotations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			type TEXT NOT NULL CHECK (type IN ('notice', 'warning', 'error')),
			message TEXT NOT NULL,
			location_file_id INTEGER REFERENCES files(id),
			location_line INTEGER,
			location_column INTEGER,
			attachment_content_type TEXT,
			attachment_path TEXT,
			attachment_body TEXT
		)
	`;
	yield* sql`CREATE INDEX idx_test_annotations_case ON test_annotations(test_case_id)`;
	yield* sql`CREATE INDEX idx_test_annotations_type ON test_annotations(type)`;

	// 15. test_artifacts
	yield* sql`
		CREATE TABLE test_artifacts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			message TEXT,
			location_file_id INTEGER REFERENCES files(id),
			location_line INTEGER,
			location_column INTEGER
		)
	`;
	yield* sql`CREATE INDEX idx_test_artifacts_case ON test_artifacts(test_case_id)`;

	// 16. attachments
	yield* sql`
		CREATE TABLE attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			artifact_id INTEGER REFERENCES test_artifacts(id) ON DELETE CASCADE,
			annotation_id INTEGER REFERENCES test_annotations(id) ON DELETE CASCADE,
			content_type TEXT,
			path TEXT,
			body BLOB,
			CHECK ((artifact_id IS NOT NULL) != (annotation_id IS NOT NULL))
		)
	`;

	// 17. import_durations
	yield* sql`
		CREATE TABLE import_durations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			module_id INTEGER NOT NULL REFERENCES test_modules(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id),
			self_time REAL NOT NULL,
			total_time REAL NOT NULL,
			external INTEGER CHECK (external IN (0, 1)),
			importer_file_id INTEGER REFERENCES files(id)
		)
	`;
	yield* sql`CREATE INDEX idx_import_durations_module ON import_durations(module_id)`;
	yield* sql`CREATE INDEX idx_import_durations_time ON import_durations(total_time)`;
	yield* sql`CREATE INDEX idx_import_durations_importer ON import_durations(importer_file_id)`;

	// 18. task_metadata
	yield* sql`
		CREATE TABLE task_metadata (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
			test_suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
			module_id INTEGER REFERENCES test_modules(id) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			CHECK (
				(test_case_id IS NOT NULL) + (test_suite_id IS NOT NULL)
				+ (module_id IS NOT NULL) = 1
			)
		)
	`;
	yield* sql`CREATE INDEX idx_task_metadata_key ON task_metadata(key)`;

	// 19. console_logs
	yield* sql`
		CREATE TABLE console_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
			content TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('stdout', 'stderr')),
			timestamp INTEGER NOT NULL,
			origin TEXT
		)
	`;
	yield* sql`CREATE INDEX idx_console_logs_test ON console_logs(test_case_id)`;
	yield* sql`CREATE INDEX idx_console_logs_run ON console_logs(run_id)`;

	// 20. test_history
	yield* sql`
		CREATE TABLE test_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			project TEXT NOT NULL,
			full_name TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('passed', 'failed', 'skipped', 'pending')),
			duration INTEGER,
			flaky INTEGER CHECK (flaky IN (0, 1)),
			retry_count INTEGER DEFAULT 0,
			error_message TEXT,
			UNIQUE(project, full_name, timestamp)
		)
	`;
	yield* sql`CREATE INDEX idx_test_history_lookup ON test_history(project, full_name)`;
	yield* sql`CREATE INDEX idx_test_history_full_name ON test_history(full_name, timestamp)`;
	yield* sql`CREATE INDEX idx_test_history_run ON test_history(run_id)`;

	// 21. coverage_baselines
	// pattern uses an empty-string sentinel ('') for global (no-pattern) rows so that
	// UNIQUE(project, metric, pattern) fires correctly on upsert. SQLite NULL values do
	// not participate in UNIQUE comparisons, so pattern=NULL would allow duplicate rows
	// per metric; '' is a safe sentinel because glob patterns are always non-empty.
	yield* sql`
		CREATE TABLE coverage_baselines (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project TEXT NOT NULL,
			metric TEXT NOT NULL CHECK (metric IN (
				'lines', 'functions', 'branches', 'statements'
			)),
			value REAL NOT NULL,
			pattern TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL,
			UNIQUE(project, metric, pattern)
		)
	`;

	// 22. coverage_trends
	yield* sql`
		CREATE TABLE coverage_trends (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			project TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			lines REAL NOT NULL,
			functions REAL NOT NULL,
			branches REAL NOT NULL,
			statements REAL NOT NULL,
			direction TEXT NOT NULL CHECK (direction IN (
				'improving', 'regressing', 'stable'
			)),
			targets_hash TEXT,
			UNIQUE(project, timestamp)
		)
	`;
	yield* sql`CREATE INDEX idx_coverage_trends_lookup ON coverage_trends(project)`;
	yield* sql`CREATE INDEX idx_coverage_trends_run ON coverage_trends(run_id)`;

	// 23. file_coverage
	//
	// `tier` distinguishes the build-failing "below_threshold" tier
	// from the warning "below_target" tier. Without it the reporter
	// can only safely write one tier per row and the CLI's `coverage`
	// subcommand has no aspirational-target gaps to surface when the
	// minimum is met. Default value preserves the only tier that
	// existed before the column was introduced.
	yield* sql`
		CREATE TABLE file_coverage (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id),
			statements REAL NOT NULL,
			branches REAL NOT NULL,
			functions REAL NOT NULL,
			lines REAL NOT NULL,
			uncovered_lines TEXT,
			tier TEXT NOT NULL DEFAULT 'below_threshold'
				CHECK (tier IN ('below_threshold', 'below_target'))
		)
	`;
	yield* sql`CREATE INDEX idx_file_coverage_run ON file_coverage(run_id)`;
	yield* sql`CREATE INDEX idx_file_coverage_file ON file_coverage(file_id)`;
	yield* sql`CREATE INDEX idx_file_coverage_run_tier ON file_coverage(run_id, tier)`;

	// 24. source_test_map
	yield* sql`
		CREATE TABLE source_test_map (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_file_id INTEGER NOT NULL REFERENCES files(id),
			test_module_id INTEGER NOT NULL REFERENCES test_modules(id) ON DELETE CASCADE,
			mapping_type TEXT NOT NULL CHECK (mapping_type IN (
				'convention', 'import_analysis', 'coverage_correlation'
			)),
			UNIQUE(source_file_id, test_module_id, mapping_type)
		)
	`;
	yield* sql`CREATE INDEX idx_source_test_map_source ON source_test_map(source_file_id)`;
	yield* sql`CREATE INDEX idx_source_test_map_module ON source_test_map(test_module_id)`;

	// 25. notes
	yield* sql`
		CREATE TABLE notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			scope TEXT NOT NULL CHECK (scope IN (
				'global', 'project', 'module', 'suite', 'test', 'note'
			)),
			project TEXT,
			test_full_name TEXT,
			module_path TEXT,
			parent_note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
			created_by TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT,
			pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
		)
	`;
	yield* sql`CREATE INDEX idx_notes_scope ON notes(scope)`;
	yield* sql`CREATE INDEX idx_notes_project ON notes(project)`;
	yield* sql`CREATE INDEX idx_notes_test ON notes(test_full_name)`;
	yield* sql`CREATE INDEX idx_notes_module ON notes(module_path)`;
	yield* sql`CREATE INDEX idx_notes_parent ON notes(parent_note_id)`;
	yield* sql`CREATE INDEX idx_notes_created_by ON notes(created_by)`;

	// notes_fts virtual table + triggers added in Task 16 with corrected
	// BEFORE/AFTER UPDATE pattern.

	// 26. sessions
	yield* sql`
		CREATE TABLE sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cc_session_id TEXT UNIQUE NOT NULL,
			project TEXT NOT NULL,
			cwd TEXT NOT NULL,
			agent_kind TEXT NOT NULL CHECK (agent_kind IN ('main', 'subagent')),
			agent_type TEXT,
			parent_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
			triage_was_non_empty INTEGER NOT NULL DEFAULT 0 CHECK (triage_was_non_empty IN (0, 1)),
			started_at TEXT NOT NULL,
			ended_at TEXT,
			end_reason TEXT
		)
	`;
	yield* sql`CREATE INDEX idx_sessions_project ON sessions(project, started_at DESC)`;
	yield* sql`CREATE INDEX idx_sessions_parent ON sessions(parent_session_id)`;

	// 27. turns
	yield* sql`
		CREATE TABLE turns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			turn_no INTEGER NOT NULL,
			type TEXT NOT NULL CHECK (type IN (
				'user_prompt', 'tool_call', 'tool_result', 'file_edit',
				'hook_fire', 'note', 'hypothesis'
			)),
			payload TEXT NOT NULL,
			occurred_at TEXT NOT NULL,
			UNIQUE (session_id, turn_no)
		)
	`;
	yield* sql`CREATE INDEX idx_turns_session ON turns(session_id, turn_no DESC)`;
	yield* sql`CREATE INDEX idx_turns_type ON turns(type, session_id)`;

	// 28. tool_invocations
	yield* sql`
		CREATE TABLE tool_invocations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			tool_name TEXT NOT NULL,
			params_hash TEXT,
			result_summary TEXT,
			duration_ms INTEGER,
			success INTEGER NOT NULL CHECK (success IN (0, 1))
		)
	`;
	yield* sql`CREATE INDEX idx_tool_invocations_turn ON tool_invocations(turn_id)`;
	yield* sql`CREATE INDEX idx_tool_invocations_tool_name ON tool_invocations(tool_name, turn_id)`;

	// 29. file_edits
	yield* sql`
		CREATE TABLE file_edits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
			edit_kind TEXT NOT NULL CHECK (edit_kind IN ('write', 'edit', 'multi_edit')),
			lines_added INTEGER,
			lines_removed INTEGER,
			diff TEXT
		)
	`;
	yield* sql`CREATE INDEX idx_file_edits_turn ON file_edits(turn_id)`;
	yield* sql`CREATE INDEX idx_file_edits_file ON file_edits(file_id, turn_id DESC)`;

	// 30. hypotheses
	yield* sql`
		CREATE TABLE hypotheses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			created_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
			content TEXT NOT NULL,
			cited_test_error_id INTEGER REFERENCES test_errors(id) ON DELETE SET NULL,
			cited_stack_frame_id INTEGER REFERENCES stack_frames(id) ON DELETE SET NULL,
			validated_turn_id INTEGER REFERENCES turns(id) ON DELETE SET NULL,
			validated_at TEXT,
			validation_outcome TEXT CHECK (validation_outcome IS NULL OR validation_outcome IN (
				'confirmed', 'refuted', 'abandoned'
			))
		)
	`;
	yield* sql`CREATE INDEX idx_hypotheses_session ON hypotheses(session_id, validated_at)`;

	// 31. commits
	yield* sql`
		CREATE TABLE commits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sha TEXT UNIQUE NOT NULL,
			parent_sha TEXT,
			message TEXT,
			author TEXT,
			committed_at TEXT,
			branch TEXT
		)
	`;

	// 32. run_changed_files
	yield* sql`
		CREATE TABLE run_changed_files (
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
			change_kind TEXT NOT NULL CHECK (change_kind IN (
				'added', 'modified', 'deleted', 'renamed', 'untracked-modified'
			)),
			commit_sha TEXT,
			PRIMARY KEY (run_id, file_id)
		)
	`;
	yield* sql`CREATE INDEX idx_run_changed_files_file ON run_changed_files(file_id)`;

	// 33. run_triggers
	yield* sql`
		CREATE TABLE run_triggers (
			run_id INTEGER PRIMARY KEY REFERENCES test_runs(id) ON DELETE CASCADE,
			trigger TEXT NOT NULL CHECK (trigger IN (
				'cli', 'ide', 'ci', 'agent', 'pre-commit', 'watch'
			)),
			invocation_method TEXT CHECK (invocation_method IS NULL OR invocation_method IN (
				'mcp', 'cli', 'bash', 'ide-runner', 'pre-commit-hook'
			)),
			-- FK to sessions.id (integer PK), NOT the cc_session_id UUID string.
			agent_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
			watch_trigger_files TEXT
		)
	`;
	yield* sql`CREATE INDEX idx_run_triggers_session ON run_triggers(agent_session_id)`;

	// 34. build_artifacts
	yield* sql`
		CREATE TABLE build_artifacts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER REFERENCES test_runs(id) ON DELETE CASCADE,
			tool_kind TEXT NOT NULL,
			exit_code INTEGER NOT NULL,
			output TEXT,
			duration_ms INTEGER,
			captured_at TEXT NOT NULL
		)
	`;
	yield* sql`CREATE INDEX idx_build_artifacts_run ON build_artifacts(run_id, tool_kind)`;

	// 35. tdd_sessions
	yield* sql`
		CREATE TABLE tdd_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			goal TEXT NOT NULL,
			run_id TEXT,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			outcome TEXT CHECK (outcome IS NULL OR outcome IN (
				'succeeded', 'blocked', 'abandoned'
			)),
			parent_tdd_session_id INTEGER REFERENCES tdd_sessions(id) ON DELETE SET NULL,
			summary_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_sessions_session ON tdd_sessions(session_id, ended_at)`;
	yield* sql`CREATE UNIQUE INDEX idx_tdd_sessions_session_run ON tdd_sessions(session_id, run_id) WHERE run_id IS NOT NULL`;

	// 36. tdd_session_goals
	yield* sql`
		CREATE TABLE tdd_session_goals (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER NOT NULL REFERENCES tdd_sessions(id) ON DELETE CASCADE,
			ordinal INTEGER NOT NULL,
			goal TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
				'pending', 'in_progress', 'done', 'abandoned'
			)),
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			UNIQUE (session_id, ordinal)
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_session_goals_session ON tdd_session_goals(session_id, id)`;
	yield* sql`CREATE INDEX idx_tdd_session_goals_session_status ON tdd_session_goals(session_id, status)`;

	// 37. tdd_session_behaviors
	yield* sql`
		CREATE TABLE tdd_session_behaviors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			goal_id INTEGER NOT NULL REFERENCES tdd_session_goals(id) ON DELETE CASCADE,
			ordinal INTEGER NOT NULL,
			behavior TEXT NOT NULL,
			suggested_test_name TEXT,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
				'pending', 'in_progress', 'done', 'abandoned'
			)),
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			UNIQUE (goal_id, ordinal)
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_session_behaviors_goal ON tdd_session_behaviors(goal_id, id)`;
	yield* sql`CREATE INDEX idx_tdd_session_behaviors_goal_status ON tdd_session_behaviors(goal_id, status)`;

	// 38. tdd_behavior_dependencies (junction table replacing JSON depends_on_behavior_ids)
	yield* sql`
		CREATE TABLE tdd_behavior_dependencies (
			behavior_id INTEGER NOT NULL REFERENCES tdd_session_behaviors(id) ON DELETE CASCADE,
			depends_on_id INTEGER NOT NULL REFERENCES tdd_session_behaviors(id) ON DELETE CASCADE,
			PRIMARY KEY (behavior_id, depends_on_id),
			CHECK (behavior_id != depends_on_id)
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_behavior_dependencies_depends_on ON tdd_behavior_dependencies(depends_on_id)`;

	// 39. tdd_phases (behavior_id CASCADE so phase history dies with the behavior)
	yield* sql`
		CREATE TABLE tdd_phases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tdd_session_id INTEGER NOT NULL REFERENCES tdd_sessions(id) ON DELETE CASCADE,
			behavior_id INTEGER REFERENCES tdd_session_behaviors(id) ON DELETE CASCADE,
			phase TEXT NOT NULL CHECK (phase IN (
				'spike', 'red', 'red.triangulate', 'green', 'green.fake-it',
				'refactor', 'extended-red', 'green-without-red'
			)),
			started_at TEXT NOT NULL,
			ended_at TEXT,
			transition_reason TEXT,
			parent_phase_id INTEGER REFERENCES tdd_phases(id) ON DELETE SET NULL
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_phases_tdd_session ON tdd_phases(tdd_session_id, started_at DESC)`;
	yield* sql`CREATE INDEX idx_tdd_phases_behavior ON tdd_phases(behavior_id, started_at DESC)`;

	// 40. tdd_artifacts (with behavior_id for behavior-scoped queries)
	yield* sql`
		CREATE TABLE tdd_artifacts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			phase_id INTEGER NOT NULL REFERENCES tdd_phases(id) ON DELETE CASCADE,
			behavior_id INTEGER REFERENCES tdd_session_behaviors(id) ON DELETE CASCADE,
			artifact_kind TEXT NOT NULL CHECK (artifact_kind IN (
				'test_written', 'test_failed_run', 'code_written',
				'test_passed_run', 'refactor', 'test_weakened'
			)),
			file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
			test_case_id INTEGER REFERENCES test_cases(id) ON DELETE SET NULL,
			test_run_id INTEGER REFERENCES test_runs(id) ON DELETE SET NULL,
			test_first_failure_run_id INTEGER REFERENCES test_runs(id) ON DELETE SET NULL,
			diff_excerpt TEXT,
			recorded_at TEXT NOT NULL,
			UNIQUE (phase_id, artifact_kind, file_id, test_run_id)
		)
	`;
	yield* sql`CREATE INDEX idx_tdd_artifacts_phase ON tdd_artifacts(phase_id, recorded_at)`;
	yield* sql`CREATE INDEX idx_tdd_artifacts_behavior ON tdd_artifacts(behavior_id, recorded_at)`;

	// 39. failure_signatures
	yield* sql`
		CREATE TABLE failure_signatures (
			signature_hash TEXT PRIMARY KEY,
			first_seen_run_id INTEGER REFERENCES test_runs(id) ON DELETE SET NULL,
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT,
			occurrence_count INTEGER NOT NULL DEFAULT 1
		)
	`;
	yield* sql`CREATE INDEX idx_failure_signatures_last_seen ON failure_signatures(last_seen_at DESC)`;

	// Augment test_errors with signature_hash
	yield* sql`ALTER TABLE test_errors ADD COLUMN signature_hash TEXT REFERENCES failure_signatures(signature_hash) ON DELETE SET NULL`;
	yield* sql`CREATE INDEX idx_test_errors_signature ON test_errors(signature_hash)`;

	// Augment stack_frames with source-map-resolved coordinates
	yield* sql`ALTER TABLE stack_frames ADD COLUMN source_mapped_line INTEGER`;
	yield* sql`ALTER TABLE stack_frames ADD COLUMN function_boundary_line INTEGER`;

	// 40. hook_executions
	yield* sql`
		CREATE TABLE hook_executions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
			test_module_id INTEGER REFERENCES test_modules(id) ON DELETE CASCADE,
			test_suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
			test_case_id INTEGER REFERENCES test_cases(id) ON DELETE CASCADE,
			hook_kind TEXT NOT NULL CHECK (hook_kind IN (
				'beforeAll', 'beforeEach', 'afterEach', 'afterAll'
			)),
			passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
			duration_ms INTEGER,
			error_id INTEGER REFERENCES test_errors(id) ON DELETE SET NULL,
			CHECK (
				(test_module_id IS NOT NULL) +
				(test_suite_id IS NOT NULL) +
				(test_case_id IS NOT NULL) <= 1
			)
		)
	`;
	yield* sql`CREATE INDEX idx_hook_executions_run ON hook_executions(run_id)`;

	// 41. mcp_idempotent_responses
	yield* sql`
		CREATE TABLE mcp_idempotent_responses (
			procedure_path TEXT NOT NULL,
			key TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (procedure_path, key)
		)
	`;
	yield* sql`CREATE INDEX idx_mcp_idempotent_responses_path ON mcp_idempotent_responses(procedure_path, created_at DESC)`;

	// 42. notes_fts (FTS5 virtual table with corrected trigger pattern).
	// Indexes both title and content so searchNotes can match either. The 1.x
	// schema also indexed both; dropping title here would silently break
	// title-based search.
	yield* sql`
		CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, content='notes', content_rowid='id')
	`;
	yield* sql`
		CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
			INSERT INTO notes_fts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
		END
	`;
	yield* sql`
		CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
			INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', OLD.id, OLD.title, OLD.content);
		END
	`;
	// CORRECTED PATTERN: BEFORE UPDATE for the delete (captures OLD values
	// before the UPDATE rewrites them). AFTER UPDATE for insert with NEW values.
	yield* sql`
		CREATE TRIGGER notes_bu BEFORE UPDATE ON notes BEGIN
			INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', OLD.id, OLD.title, OLD.content);
		END
	`;
	yield* sql`
		CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
			INSERT INTO notes_fts(rowid, title, content) VALUES (NEW.id, NEW.title, NEW.content);
		END
	`;
});

export default migration;
