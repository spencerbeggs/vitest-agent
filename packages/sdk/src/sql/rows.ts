import { Schema } from "effect";

// Internal row schemas for SQL result sets.
// These map 1:1 to table columns and are used by DataReaderLive
// for typed SQL queries via SqlSchema.findAll and SqlSchema.findOne.
// NOT part of the public API.

export const FileRow = Schema.Struct({
	id: Schema.Number,
	path: Schema.String,
});

export const SettingsRow = Schema.Struct({
	hash: Schema.String,
	vitest_version: Schema.String,
	pool: Schema.NullOr(Schema.String),
	environment: Schema.NullOr(Schema.String),
	test_timeout: Schema.NullOr(Schema.Number),
	hook_timeout: Schema.NullOr(Schema.Number),
	slow_test_threshold: Schema.NullOr(Schema.Number),
	max_concurrency: Schema.NullOr(Schema.Number),
	max_workers: Schema.NullOr(Schema.Number),
	isolate: Schema.NullOr(Schema.Number),
	bail: Schema.NullOr(Schema.Number),
	globals: Schema.NullOr(Schema.Number),
	file_parallelism: Schema.NullOr(Schema.Number),
	sequence_seed: Schema.NullOr(Schema.Number),
	coverage_provider: Schema.NullOr(Schema.String),
	created_at: Schema.String,
});

export const TestRunRow = Schema.Struct({
	id: Schema.Number,
	invocation_id: Schema.String,
	project: Schema.String,
	settings_hash: Schema.String,
	timestamp: Schema.String,
	commit_sha: Schema.NullOr(Schema.String),
	branch: Schema.NullOr(Schema.String),
	reason: Schema.String,
	duration: Schema.Number,
	total: Schema.Number,
	passed: Schema.Number,
	failed: Schema.Number,
	skipped: Schema.Number,
	scoped: Schema.Number,
	snapshot_added: Schema.Number,
	snapshot_matched: Schema.Number,
	snapshot_unmatched: Schema.Number,
	snapshot_updated: Schema.Number,
	snapshot_unchecked: Schema.Number,
	snapshot_total: Schema.Number,
	snapshot_failure: Schema.Number,
	snapshot_did_update: Schema.Number,
	snapshot_files_added: Schema.Number,
	snapshot_files_removed: Schema.Number,
	snapshot_files_unmatched: Schema.Number,
	snapshot_files_updated: Schema.Number,
	created_at: Schema.String,
});

export const TestModuleRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	file_id: Schema.Number,
	relative_module_id: Schema.String,
	state: Schema.String,
	duration: Schema.NullOr(Schema.Number),
	environment_setup_duration: Schema.NullOr(Schema.Number),
	prepare_duration: Schema.NullOr(Schema.Number),
	collect_duration: Schema.NullOr(Schema.Number),
	setup_duration: Schema.NullOr(Schema.Number),
	heap: Schema.NullOr(Schema.Number),
});

export const TestSuiteRow = Schema.Struct({
	id: Schema.Number,
	module_id: Schema.Number,
	parent_suite_id: Schema.NullOr(Schema.Number),
	name: Schema.String,
	full_name: Schema.String,
	state: Schema.String,
	mode: Schema.NullOr(Schema.String),
	concurrent: Schema.NullOr(Schema.Number),
	shuffle: Schema.NullOr(Schema.Number),
	retry: Schema.NullOr(Schema.Number),
	repeats: Schema.NullOr(Schema.Number),
	location_line: Schema.NullOr(Schema.Number),
	location_column: Schema.NullOr(Schema.Number),
});

export const TestCaseRow = Schema.Struct({
	id: Schema.Number,
	module_id: Schema.Number,
	suite_id: Schema.NullOr(Schema.Number),
	vitest_id: Schema.NullOr(Schema.String),
	name: Schema.String,
	full_name: Schema.String,
	state: Schema.String,
	classification: Schema.NullOr(Schema.String),
	duration: Schema.NullOr(Schema.Number),
	start_time: Schema.NullOr(Schema.Number),
	flaky: Schema.NullOr(Schema.Number),
	slow: Schema.NullOr(Schema.Number),
	retry_count: Schema.Number,
	repeat_count: Schema.Number,
	heap: Schema.NullOr(Schema.Number),
	mode: Schema.NullOr(Schema.String),
	each: Schema.NullOr(Schema.Number),
	fails: Schema.NullOr(Schema.Number),
	concurrent: Schema.NullOr(Schema.Number),
	shuffle: Schema.NullOr(Schema.Number),
	timeout: Schema.NullOr(Schema.Number),
	skip_note: Schema.NullOr(Schema.String),
	location_line: Schema.NullOr(Schema.Number),
	location_column: Schema.NullOr(Schema.Number),
});

export const TestErrorRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	test_case_id: Schema.NullOr(Schema.Number),
	test_suite_id: Schema.NullOr(Schema.Number),
	module_id: Schema.NullOr(Schema.Number),
	scope: Schema.String,
	name: Schema.NullOr(Schema.String),
	message: Schema.String,
	diff: Schema.NullOr(Schema.String),
	actual: Schema.NullOr(Schema.String),
	expected: Schema.NullOr(Schema.String),
	stack: Schema.NullOr(Schema.String),
	cause_error_id: Schema.NullOr(Schema.Number),
	ordinal: Schema.Number,
});

export const StackFrameRow = Schema.Struct({
	id: Schema.Number,
	error_id: Schema.Number,
	ordinal: Schema.Number,
	method: Schema.NullOr(Schema.String),
	file_id: Schema.NullOr(Schema.Number),
	line: Schema.NullOr(Schema.Number),
	col: Schema.NullOr(Schema.Number),
});

export const TestHistoryRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	project: Schema.String,
	full_name: Schema.String,
	timestamp: Schema.String,
	state: Schema.String,
	duration: Schema.NullOr(Schema.Number),
	flaky: Schema.NullOr(Schema.Number),
	retry_count: Schema.Number,
	error_message: Schema.NullOr(Schema.String),
});

export const CoverageBaselineRow = Schema.Struct({
	id: Schema.Number,
	project: Schema.String,
	metric: Schema.String,
	value: Schema.Number,
	pattern: Schema.NullOr(Schema.String),
	updated_at: Schema.String,
});

export const CoverageTrendRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	project: Schema.String,
	timestamp: Schema.String,
	lines: Schema.Number,
	functions: Schema.Number,
	branches: Schema.Number,
	statements: Schema.Number,
	direction: Schema.String,
	targets_hash: Schema.NullOr(Schema.String),
});

export const FileCoverageRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	file_id: Schema.Number,
	statements: Schema.Number,
	branches: Schema.Number,
	functions: Schema.Number,
	lines: Schema.Number,
	uncovered_lines: Schema.NullOr(Schema.String),
});

export const NoteRow = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
	content: Schema.String,
	scope: Schema.String,
	project: Schema.NullOr(Schema.String),
	test_full_name: Schema.NullOr(Schema.String),
	module_path: Schema.NullOr(Schema.String),
	parent_note_id: Schema.NullOr(Schema.Number),
	created_by: Schema.NullOr(Schema.String),
	created_at: Schema.String,
	updated_at: Schema.String,
	expires_at: Schema.NullOr(Schema.String),
	pinned: Schema.Number,
});

export const SourceTestMapRow = Schema.Struct({
	id: Schema.Number,
	source_file_id: Schema.Number,
	test_module_id: Schema.Number,
	mapping_type: Schema.String,
});

// Phase 6 / 2.0 schema additions

export const SessionRow = Schema.Struct({
	id: Schema.Number,
	cc_session_id: Schema.String,
	project: Schema.String,
	cwd: Schema.String,
	agent_kind: Schema.String,
	agent_type: Schema.NullOr(Schema.String),
	parent_session_id: Schema.NullOr(Schema.Number),
	triage_was_non_empty: Schema.Number,
	started_at: Schema.String,
	ended_at: Schema.NullOr(Schema.String),
	end_reason: Schema.NullOr(Schema.String),
});

export const TurnRow = Schema.Struct({
	id: Schema.Number,
	session_id: Schema.Number,
	turn_no: Schema.Number,
	type: Schema.String,
	payload: Schema.String,
	occurred_at: Schema.String,
});

export const ToolInvocationRow = Schema.Struct({
	id: Schema.Number,
	turn_id: Schema.Number,
	tool_name: Schema.String,
	params_hash: Schema.NullOr(Schema.String),
	result_summary: Schema.NullOr(Schema.String),
	duration_ms: Schema.NullOr(Schema.Number),
	success: Schema.Number,
});

export const FileEditRow = Schema.Struct({
	id: Schema.Number,
	turn_id: Schema.Number,
	file_id: Schema.Number,
	edit_kind: Schema.String,
	lines_added: Schema.NullOr(Schema.Number),
	lines_removed: Schema.NullOr(Schema.Number),
	diff: Schema.NullOr(Schema.String),
});

export const HypothesisRow = Schema.Struct({
	id: Schema.Number,
	session_id: Schema.Number,
	created_turn_id: Schema.NullOr(Schema.Number),
	content: Schema.String,
	cited_test_error_id: Schema.NullOr(Schema.Number),
	cited_stack_frame_id: Schema.NullOr(Schema.Number),
	validated_turn_id: Schema.NullOr(Schema.Number),
	validated_at: Schema.NullOr(Schema.String),
	validation_outcome: Schema.NullOr(Schema.String),
});

export const CommitRow = Schema.Struct({
	id: Schema.Number,
	sha: Schema.String,
	parent_sha: Schema.NullOr(Schema.String),
	message: Schema.NullOr(Schema.String),
	author: Schema.NullOr(Schema.String),
	committed_at: Schema.NullOr(Schema.String),
	branch: Schema.NullOr(Schema.String),
});

export const RunChangedFileRow = Schema.Struct({
	run_id: Schema.Number,
	file_id: Schema.Number,
	change_kind: Schema.String,
	commit_sha: Schema.NullOr(Schema.String),
});

export const RunTriggerRow = Schema.Struct({
	run_id: Schema.Number,
	trigger: Schema.String,
	invocation_method: Schema.NullOr(Schema.String),
	agent_session_id: Schema.NullOr(Schema.Number),
	watch_trigger_files: Schema.NullOr(Schema.String),
});

export const BuildArtifactRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.NullOr(Schema.Number),
	tool_kind: Schema.String,
	exit_code: Schema.Number,
	output: Schema.NullOr(Schema.String),
	duration_ms: Schema.NullOr(Schema.Number),
	captured_at: Schema.String,
});

export const TddSessionRow = Schema.Struct({
	id: Schema.Number,
	session_id: Schema.Number,
	goal: Schema.String,
	started_at: Schema.String,
	ended_at: Schema.NullOr(Schema.String),
	outcome: Schema.NullOr(Schema.String),
	parent_tdd_session_id: Schema.NullOr(Schema.Number),
	summary_note_id: Schema.NullOr(Schema.Number),
	run_id: Schema.NullOr(Schema.String),
});

export const TddSessionGoalRow = Schema.Struct({
	id: Schema.Number,
	session_id: Schema.Number,
	ordinal: Schema.Number,
	goal: Schema.String,
	status: Schema.String,
	created_at: Schema.String,
});

export const TddSessionBehaviorRow = Schema.Struct({
	id: Schema.Number,
	goal_id: Schema.Number,
	ordinal: Schema.Number,
	behavior: Schema.String,
	suggested_test_name: Schema.NullOr(Schema.String),
	status: Schema.String,
	created_at: Schema.String,
});

export const TddBehaviorDependencyRow = Schema.Struct({
	behavior_id: Schema.Number,
	depends_on_id: Schema.Number,
});

export const TddPhaseRow = Schema.Struct({
	id: Schema.Number,
	tdd_session_id: Schema.Number,
	behavior_id: Schema.NullOr(Schema.Number),
	phase: Schema.String,
	started_at: Schema.String,
	ended_at: Schema.NullOr(Schema.String),
	transition_reason: Schema.NullOr(Schema.String),
	parent_phase_id: Schema.NullOr(Schema.Number),
});

export const TddArtifactRow = Schema.Struct({
	id: Schema.Number,
	phase_id: Schema.Number,
	artifact_kind: Schema.String,
	file_id: Schema.NullOr(Schema.Number),
	test_case_id: Schema.NullOr(Schema.Number),
	test_run_id: Schema.NullOr(Schema.Number),
	test_first_failure_run_id: Schema.NullOr(Schema.Number),
	diff_excerpt: Schema.NullOr(Schema.String),
	recorded_at: Schema.String,
});

export const FailureSignatureRow = Schema.Struct({
	signature_hash: Schema.String,
	first_seen_run_id: Schema.NullOr(Schema.Number),
	first_seen_at: Schema.String,
	last_seen_at: Schema.NullOr(Schema.String),
	occurrence_count: Schema.Number,
});

export const HookExecutionRow = Schema.Struct({
	id: Schema.Number,
	run_id: Schema.Number,
	test_module_id: Schema.NullOr(Schema.Number),
	test_suite_id: Schema.NullOr(Schema.Number),
	test_case_id: Schema.NullOr(Schema.Number),
	hook_kind: Schema.String,
	passed: Schema.Number,
	duration_ms: Schema.NullOr(Schema.Number),
	error_id: Schema.NullOr(Schema.Number),
});
