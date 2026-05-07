import { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Layer, Option } from "effect";
import { DataStoreError, extractSqlReason } from "../errors/DataStoreError.js";
import {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddSessionAlreadyEndedError,
	TddSessionNotFoundError,
} from "../errors/TddErrors.js";
import type { CoverageBaselines } from "../schemas/Baselines.js";
import type { BehaviorRow, BehaviorStatus, GoalRow, GoalStatus } from "../schemas/Tdd.js";
import type { TrendEntry } from "../schemas/Trends.js";
import type {
	CreateBehaviorInput,
	CreateGoalInput,
	EndTddSessionInput,
	FailureSignatureWriteInput,
	FileCoverageInput,
	HypothesisInput,
	IdempotentResponseInput,
	ModuleInput,
	NoteInput,
	SessionInput,
	SettingsInput,
	SuiteInput,
	TddSessionInput,
	TestCaseInput,
	TestErrorInput,
	TestRunInput,
	TurnInput,
	UpdateBehaviorInput,
	UpdateGoalInput,
	ValidateHypothesisInput,
	WriteCommitInput,
	WriteRunChangedFilesInput,
	WriteTddArtifactInput,
	WriteTddPhaseInput,
	WriteTddPhaseOutput,
} from "../services/DataStore.js";
import { DataStore } from "../services/DataStore.js";

const isLegalLifecycleTransition = (from: string, to: string): boolean => {
	if (from === to) return true;
	if (from === "done" || from === "abandoned") return false;
	if (from === "pending") return to === "in_progress" || to === "done" || to === "abandoned";
	if (from === "in_progress") return to === "done" || to === "abandoned";
	return false;
};

const goalRowFromDb = (row: {
	id: number;
	session_id: number;
	ordinal: number;
	goal: string;
	status: string;
	created_at: string;
}): GoalRow => ({
	id: row.id,
	sessionId: row.session_id,
	ordinal: row.ordinal,
	goal: row.goal,
	status: row.status as GoalStatus,
	createdAt: row.created_at,
});

const behaviorRowFromDb = (row: {
	id: number;
	goal_id: number;
	ordinal: number;
	behavior: string;
	suggested_test_name: string | null;
	status: string;
	created_at: string;
}): BehaviorRow => ({
	id: row.id,
	goalId: row.goal_id,
	ordinal: row.ordinal,
	behavior: row.behavior,
	suggestedTestName: row.suggested_test_name,
	status: row.status as BehaviorStatus,
	createdAt: row.created_at,
});

const boolToInt = (v: boolean | undefined): number | null => (v === undefined ? null : v ? 1 : 0);

export const DataStoreLive: Layer.Layer<DataStore, never, SqlClient> = Layer.effect(
	DataStore,
	Effect.gen(function* () {
		const sql = yield* SqlClient;

		// Ensure FK enforcement on every connection (PRAGMA is per-connection, not persistent)
		yield* sql`PRAGMA foreign_keys=ON`.pipe(Effect.catchAll(() => Effect.void));

		const ensureFile = (filePath: string): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("ensureFile").pipe(Effect.annotateLogs({ filePath }));
				yield* sql`INSERT OR IGNORE INTO files (path) VALUES (${filePath})`;
				const rows = yield* sql<{ id: number }>`SELECT id FROM files WHERE path = ${filePath}`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) => new DataStoreError({ operation: "write", table: "files", reason: extractSqlReason(e) })),
			);

		const writeSettings = (
			hash: string,
			settings: SettingsInput,
			envVars: Record<string, string>,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeSettings").pipe(Effect.annotateLogs({ hash }));
				yield* sql`INSERT OR IGNORE INTO settings (hash, vitest_version, pool, environment, test_timeout, hook_timeout, slow_test_threshold, max_concurrency, max_workers, isolate, bail, globals, file_parallelism, sequence_seed, coverage_provider) VALUES (${hash}, ${settings.vitest_version}, ${settings.pool ?? null}, ${settings.environment ?? null}, ${settings.test_timeout ?? null}, ${settings.hook_timeout ?? null}, ${settings.slow_test_threshold ?? null}, ${settings.max_concurrency ?? null}, ${settings.max_workers ?? null}, ${boolToInt(settings.isolate)}, ${settings.bail ?? null}, ${boolToInt(settings.globals)}, ${boolToInt(settings.file_parallelism)}, ${settings.sequence_seed ?? null}, ${settings.coverage_provider ?? null})`;

				for (const [key, value] of Object.entries(envVars)) {
					yield* sql`INSERT OR IGNORE INTO settings_env_vars (settings_hash, key, value) VALUES (${hash}, ${key}, ${value})`;
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "settings", reason: extractSqlReason(e) }),
				),
			);

		const writeRun = (input: TestRunInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeRun").pipe(
					Effect.annotateLogs({ project: input.project, invocationId: input.invocationId }),
				);
				yield* sql`INSERT INTO test_runs (invocation_id, project, sub_project, settings_hash, timestamp, commit_sha, branch, reason, duration, total, passed, failed, skipped, scoped, snapshot_added, snapshot_matched, snapshot_unmatched, snapshot_updated, snapshot_unchecked, snapshot_total, snapshot_failure, snapshot_did_update, snapshot_files_added, snapshot_files_removed, snapshot_files_unmatched, snapshot_files_updated) VALUES (${input.invocationId}, ${input.project}, ${input.subProject}, ${input.settingsHash}, ${input.timestamp}, ${input.commitSha ?? null}, ${input.branch ?? null}, ${input.reason}, ${input.duration}, ${input.total}, ${input.passed}, ${input.failed}, ${input.skipped}, ${input.scoped ? 1 : 0}, ${input.snapshotAdded ?? 0}, ${input.snapshotMatched ?? 0}, ${input.snapshotUnmatched ?? 0}, ${input.snapshotUpdated ?? 0}, ${input.snapshotUnchecked ?? 0}, ${input.snapshotTotal ?? 0}, ${boolToInt(input.snapshotFailure) ?? 0}, ${boolToInt(input.snapshotDidUpdate) ?? 0}, ${input.snapshotFilesAdded ?? 0}, ${input.snapshotFilesRemoved ?? 0}, ${input.snapshotFilesUnmatched ?? 0}, ${input.snapshotFilesUpdated ?? 0})`;
				const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_runs", reason: extractSqlReason(e) }),
				),
			);

		const writeModules = (
			runId: number,
			modules: ReadonlyArray<ModuleInput>,
		): Effect.Effect<ReadonlyArray<number>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeModules").pipe(Effect.annotateLogs({ runId, count: modules.length }));
				const ids: number[] = [];
				for (const mod of modules) {
					yield* sql`INSERT INTO test_modules (run_id, file_id, relative_module_id, state, duration, environment_setup_duration, prepare_duration, collect_duration, setup_duration, heap) VALUES (${runId}, ${mod.fileId}, ${mod.relativeModuleId}, ${mod.state}, ${mod.duration ?? null}, ${mod.environmentSetupDuration ?? null}, ${mod.prepareDuration ?? null}, ${mod.collectDuration ?? null}, ${mod.setupDuration ?? null}, ${mod.heap ?? null})`;
					const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
					ids.push(rows[0].id);
				}
				return ids;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_modules", reason: extractSqlReason(e) }),
				),
			);

		const writeSuites = (
			moduleId: number,
			suites: ReadonlyArray<SuiteInput>,
		): Effect.Effect<ReadonlyArray<number>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeSuites").pipe(Effect.annotateLogs({ moduleId, count: suites.length }));
				const ids: number[] = [];
				for (const suite of suites) {
					yield* sql`INSERT INTO test_suites (module_id, parent_suite_id, name, full_name, state, mode, concurrent, shuffle, retry, repeats, location_line, location_column) VALUES (${moduleId}, ${suite.parentSuiteId ?? null}, ${suite.name}, ${suite.fullName}, ${suite.state}, ${suite.mode ?? null}, ${boolToInt(suite.concurrent)}, ${boolToInt(suite.shuffle)}, ${suite.retry ?? null}, ${suite.repeats ?? null}, ${suite.locationLine ?? null}, ${suite.locationColumn ?? null})`;
					const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
					ids.push(rows[0].id);
				}
				return ids;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_suites", reason: extractSqlReason(e) }),
				),
			);

		const writeTestCases = (
			moduleId: number,
			tests: ReadonlyArray<TestCaseInput>,
		): Effect.Effect<ReadonlyArray<number>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeTestCases").pipe(Effect.annotateLogs({ moduleId, count: tests.length }));
				const ids: number[] = [];
				for (const tc of tests) {
					yield* sql`INSERT INTO test_cases (module_id, suite_id, vitest_id, name, full_name, state, classification, duration, start_time, flaky, slow, retry_count, repeat_count, heap, mode, each, fails, concurrent, shuffle, timeout, skip_note, location_line, location_column, created_turn_id) VALUES (${moduleId}, ${tc.suiteId ?? null}, ${tc.vitestId ?? null}, ${tc.name}, ${tc.fullName}, ${tc.state}, ${tc.classification ?? null}, ${tc.duration ?? null}, ${tc.startTime ?? null}, ${boolToInt(tc.flaky)}, ${boolToInt(tc.slow)}, ${tc.retryCount ?? 0}, ${tc.repeatCount ?? 0}, ${tc.heap ?? null}, ${tc.mode ?? null}, ${boolToInt(tc.each)}, ${boolToInt(tc.fails)}, ${boolToInt(tc.concurrent)}, ${boolToInt(tc.shuffle)}, ${tc.timeout ?? null}, ${tc.skipNote ?? null}, ${tc.locationLine ?? null}, ${tc.locationColumn ?? null}, ${tc.created_turn_id ?? null})`;
					const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
					const testCaseId = rows[0].id;
					ids.push(testCaseId);

					// Write tags for this test case
					if (tc.tags && tc.tags.length > 0) {
						for (const tag of tc.tags) {
							yield* sql`INSERT OR IGNORE INTO tags (name) VALUES (${tag})`;
							const tagRows = yield* sql<{ id: number }>`SELECT id FROM tags WHERE name = ${tag}`;
							if (tagRows.length > 0) {
								yield* sql`INSERT OR IGNORE INTO test_case_tags (test_case_id, tag_id) VALUES (${testCaseId}, ${tagRows[0].id})`;
							}
						}
					}
				}
				return ids;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_cases", reason: extractSqlReason(e) }),
				),
			);

		const writeErrors = (runId: number, errors: ReadonlyArray<TestErrorInput>): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeErrors").pipe(Effect.annotateLogs({ runId, count: errors.length }));
				for (const err of errors) {
					yield* sql`INSERT INTO test_errors (run_id, test_case_id, test_suite_id, module_id, scope, name, message, diff, actual, expected, stack, cause_error_id, signature_hash, ordinal) VALUES (${runId}, ${err.testCaseId ?? null}, ${err.testSuiteId ?? null}, ${err.moduleId ?? null}, ${err.scope}, ${err.name ?? null}, ${err.message}, ${err.diff ?? null}, ${err.actual ?? null}, ${err.expected ?? null}, ${err.stack ?? null}, ${err.causeErrorId ?? null}, ${err.signatureHash ?? null}, ${err.ordinal ?? 0})`;

					// Persist structured frames. Prefer caller-provided frames (with
					// source-map and function-boundary annotations) over regex parsing.
					if (err.frames && err.frames.length > 0) {
						const errorIdRows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
						const errorId = errorIdRows[0].id;
						for (const frame of err.frames) {
							const fileId = yield* ensureFile(frame.filePath);
							yield* sql`INSERT INTO stack_frames (error_id, ordinal, method, file_id, line, col, source_mapped_line, function_boundary_line) VALUES (${errorId}, ${frame.ordinal}, ${frame.method}, ${fileId}, ${frame.line}, ${frame.col}, ${frame.sourceMappedLine ?? null}, ${frame.functionBoundaryLine ?? null})`;
						}
					} else if (err.stack) {
						const errorIdRows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
						const errorId = errorIdRows[0].id;
						const framePattern = /at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?/g;
						const frames = [...err.stack.matchAll(framePattern)];
						for (let frameOrdinal = 0; frameOrdinal < frames.length; frameOrdinal++) {
							const m = frames[frameOrdinal];
							const method = m[1] ?? null;
							const filePath = m[2];
							const line = Number.parseInt(m[3], 10);
							const col = Number.parseInt(m[4], 10);
							const fileId = yield* ensureFile(filePath);
							yield* sql`INSERT INTO stack_frames (error_id, ordinal, method, file_id, line, col, source_mapped_line, function_boundary_line) VALUES (${errorId}, ${frameOrdinal}, ${method}, ${fileId}, ${line}, ${col}, NULL, NULL)`;
						}
					}
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_errors", reason: extractSqlReason(e) }),
				),
			);

		const writeCoverage = (
			runId: number,
			coverage: ReadonlyArray<FileCoverageInput>,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeCoverage").pipe(Effect.annotateLogs({ runId, count: coverage.length }));
				for (const cov of coverage) {
					const tier = cov.tier ?? "below_threshold";
					yield* sql`INSERT INTO file_coverage (run_id, file_id, statements, branches, functions, lines, uncovered_lines, tier) VALUES (${runId}, ${cov.fileId}, ${cov.statements}, ${cov.branches}, ${cov.functions}, ${cov.lines}, ${cov.uncoveredLines ?? null}, ${tier})`;
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "file_coverage", reason: extractSqlReason(e) }),
				),
			);

		const writeHistory = (
			project: string,
			subProject: string | null,
			fullName: string,
			runId: number,
			timestamp: string,
			state: string,
			duration: number | null,
			flaky: boolean,
			retryCount: number,
			errorMessage: string | null,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeHistory").pipe(Effect.annotateLogs({ project, subProject, runId }));
				yield* sql`INSERT INTO test_history (run_id, project, sub_project, full_name, timestamp, state, duration, flaky, retry_count, error_message) VALUES (${runId}, ${project}, ${subProject}, ${fullName}, ${timestamp}, ${state}, ${duration}, ${flaky ? 1 : 0}, ${retryCount}, ${errorMessage})`;

				// Delete oldest entries beyond 10-entry window per (project, subProject, fullName)
				yield* sql`DELETE FROM test_history WHERE id NOT IN (SELECT id FROM test_history WHERE project = ${project} AND sub_project IS ${subProject} AND full_name = ${fullName} ORDER BY timestamp DESC LIMIT 10) AND project = ${project} AND sub_project IS ${subProject} AND full_name = ${fullName}`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_history", reason: extractSqlReason(e) }),
				),
			);

		const writeBaselines = (baselines: CoverageBaselines): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeBaselines").pipe(Effect.annotateLogs({ updatedAt: baselines.updatedAt }));
				const { updatedAt, global: g, patterns = [] } = baselines;

				// Baselines are stored globally (project='__global__'), not per-project.
				// The coverage_baselines table supports per-project rows but the
				// CoverageBaselines schema is a single global object. Per-project
				// baselines would require a DataStore.writeBaselines signature change.
				const metrics = ["lines", "functions", "branches", "statements"] as const;
				for (const metric of metrics) {
					const value = g[metric];
					if (value !== undefined) {
						yield* sql`INSERT INTO coverage_baselines (project, sub_project, metric, value, pattern, updated_at) VALUES ('__global__', NULL, ${metric}, ${value}, NULL, ${updatedAt}) ON CONFLICT (project, sub_project, metric, pattern) DO UPDATE SET value = ${value}, updated_at = ${updatedAt}`;
					}
				}

				// Upsert pattern metrics
				for (const [pattern, thresholds] of patterns) {
					for (const metric of metrics) {
						const value = thresholds[metric];
						if (value !== undefined) {
							yield* sql`INSERT INTO coverage_baselines (project, sub_project, metric, value, pattern, updated_at) VALUES ('__global__', NULL, ${metric}, ${value}, ${pattern}, ${updatedAt}) ON CONFLICT (project, sub_project, metric, pattern) DO UPDATE SET value = ${value}, updated_at = ${updatedAt}`;
						}
					}
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "coverage_baselines", reason: extractSqlReason(e) }),
				),
			);

		const writeTrends = (
			project: string,
			subProject: string | null,
			runId: number,
			entry: TrendEntry,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeTrends").pipe(Effect.annotateLogs({ project, subProject, runId }));
				yield* sql`INSERT INTO coverage_trends (run_id, project, sub_project, timestamp, lines, functions, branches, statements, direction, targets_hash) VALUES (${runId}, ${project}, ${subProject}, ${entry.timestamp}, ${entry.coverage.lines}, ${entry.coverage.functions}, ${entry.coverage.branches}, ${entry.coverage.statements}, ${entry.direction}, ${entry.targetsHash ?? null})`;

				// Delete oldest entries beyond 50-entry window per (project, subProject)
				yield* sql`DELETE FROM coverage_trends WHERE id NOT IN (SELECT id FROM coverage_trends WHERE project = ${project} AND sub_project IS ${subProject} ORDER BY timestamp DESC LIMIT 50) AND project = ${project} AND sub_project IS ${subProject}`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "coverage_trends", reason: extractSqlReason(e) }),
				),
			);

		const writeSourceMap = (
			sourceFilePath: string,
			testModuleId: number,
			mappingType: string,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeSourceMap").pipe(
					Effect.annotateLogs({ sourceFilePath, testModuleId, mappingType }),
				);
				const sourceFileId = yield* ensureFile(sourceFilePath);
				yield* sql`INSERT OR IGNORE INTO source_test_map (source_file_id, test_module_id, mapping_type) VALUES (${sourceFileId}, ${testModuleId}, ${mappingType})`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "source_test_map", reason: extractSqlReason(e) }),
				),
			);

		const writeNote = (note: NoteInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeNote").pipe(
					Effect.annotateLogs({ scope: note.scope, project: note.project ?? null }),
				);
				yield* sql`INSERT INTO notes (title, content, scope, project, sub_project, test_full_name, module_path, parent_note_id, created_by, expires_at, pinned) VALUES (${note.title}, ${note.content}, ${note.scope}, ${note.project ?? null}, ${note.subProject ?? null}, ${note.testFullName ?? null}, ${note.modulePath ?? null}, ${note.parentNoteId ?? null}, ${note.createdBy ?? null}, ${note.expiresAt ?? null}, ${note.pinned ? 1 : 0})`;
				const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) => new DataStoreError({ operation: "write", table: "notes", reason: extractSqlReason(e) })),
			);

		const updateNote = (id: number, fields: Partial<NoteInput>): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("updateNote").pipe(Effect.annotateLogs({ id }));
				// Build SET clauses for non-undefined fields
				const setClauses: string[] = [];
				const values: unknown[] = [];

				if (fields.title !== undefined) {
					setClauses.push("title = ?");
					values.push(fields.title);
				}
				if (fields.content !== undefined) {
					setClauses.push("content = ?");
					values.push(fields.content);
				}
				if (fields.scope !== undefined) {
					setClauses.push("scope = ?");
					values.push(fields.scope);
				}
				if (fields.project !== undefined) {
					setClauses.push("project = ?");
					values.push(fields.project);
				}
				if (fields.subProject !== undefined) {
					setClauses.push("sub_project = ?");
					values.push(fields.subProject);
				}
				if (fields.testFullName !== undefined) {
					setClauses.push("test_full_name = ?");
					values.push(fields.testFullName);
				}
				if (fields.modulePath !== undefined) {
					setClauses.push("module_path = ?");
					values.push(fields.modulePath);
				}
				if (fields.parentNoteId !== undefined) {
					setClauses.push("parent_note_id = ?");
					values.push(fields.parentNoteId);
				}
				if (fields.createdBy !== undefined) {
					setClauses.push("created_by = ?");
					values.push(fields.createdBy);
				}
				if (fields.expiresAt !== undefined) {
					setClauses.push("expires_at = ?");
					values.push(fields.expiresAt);
				}
				if (fields.pinned !== undefined) {
					setClauses.push("pinned = ?");
					values.push(fields.pinned ? 1 : 0);
				}

				if (setClauses.length === 0) return;

				// Always update updated_at
				setClauses.push("updated_at = datetime('now')");

				// sql.unsafe is required here because the SET clause is dynamic
				// (only columns with provided values are included). Column names
				// are from source code, not user input, so this is safe.
				yield* sql.unsafe(`UPDATE notes SET ${setClauses.join(", ")} WHERE id = ?`, [...values, id]);
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) => new DataStoreError({ operation: "write", table: "notes", reason: extractSqlReason(e) })),
			);

		const deleteNote = (id: number): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("deleteNote").pipe(Effect.annotateLogs({ id }));
				yield* sql`DELETE FROM notes WHERE id = ${id}`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) => new DataStoreError({ operation: "write", table: "notes", reason: extractSqlReason(e) })),
			);

		const writeSession = (input: SessionInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeSession").pipe(Effect.annotateLogs({ cc_session_id: input.cc_session_id }));
				yield* sql`INSERT INTO sessions (cc_session_id, project, sub_project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at) VALUES (${input.cc_session_id}, ${input.project}, ${input.sub_project ?? null}, ${input.cwd}, ${input.agent_kind}, ${input.agent_type ?? null}, ${input.parent_session_id ?? null}, ${boolToInt(input.triage_was_non_empty) ?? 0}, ${input.started_at})`;
				const rows = yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = ${input.cc_session_id}`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const writeTurn = (input: TurnInput): Effect.Effect<number, DataStoreError> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("writeTurn").pipe(
							Effect.annotateLogs({ session_id: input.session_id, type: input.type }),
						);
						if (input.turn_no !== undefined) {
							yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${input.session_id}, ${input.turn_no}, ${input.type}, ${input.payload}, ${input.occurred_at})`;
						} else {
							// Atomic auto-assignment: compute next turn_no inside the same INSERT
							// so concurrent writers can't both compute the same value before either
							// inserts. UNIQUE(session_id, turn_no) is enforced by the schema as a
							// safety net.
							yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) SELECT ${input.session_id}, COALESCE(MAX(turn_no), 0) + 1, ${input.type}, ${input.payload}, ${input.occurred_at} FROM turns WHERE session_id = ${input.session_id}`;
						}
						const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
						const turnId = rows[0].id;

						// Per-turn fanout: file_edit payloads land in file_edits; tool_result
						// payloads land in tool_invocations. tool_call does NOT produce a
						// tool_invocations row -- only tool_result does, so the per-call
						// outcome (success/duration_ms) is captured exactly once. Other
						// payload types (user_prompt, hypothesis, hook_fire, note) write
						// only the turns row; their detail lives in turns.payload JSON.
						if (input.type === "file_edit" || input.type === "tool_result") {
							const payload = yield* Effect.try({
								try: () => JSON.parse(input.payload) as Record<string, unknown>,
								catch: (e) =>
									new DataStoreError({
										operation: "write",
										table: input.type === "file_edit" ? "file_edits" : "tool_invocations",
										reason: `invalid turn payload JSON: ${(e as Error).message}`,
									}),
							});

							if (input.type === "file_edit") {
								const filePath = payload.file_path as string;
								yield* sql`INSERT OR IGNORE INTO files (path) VALUES (${filePath})`;
								const fileRows = yield* sql<{ id: number }>`SELECT id FROM files WHERE path = ${filePath}`;
								const fileId = fileRows[0].id;
								yield* sql`
									INSERT INTO file_edits (turn_id, file_id, edit_kind, lines_added, lines_removed, diff)
									VALUES (
										${turnId},
										${fileId},
										${payload.edit_kind as string},
										${(payload.lines_added as number | undefined) ?? null},
										${(payload.lines_removed as number | undefined) ?? null},
										${(payload.diff as string | undefined) ?? null}
									)
								`;
							} else {
								// tool_result — normalize MCP-prefixed names to short names
								// (CC sends "mcp__<server>__<name>"; store just "<name>")
								const rawToolName = payload.tool_name as string;
								const toolName =
									typeof rawToolName === "string" && rawToolName.startsWith("mcp__")
										? (rawToolName.split("__").at(-1) ?? rawToolName)
										: rawToolName;
								yield* sql`
									INSERT INTO tool_invocations (turn_id, tool_name, params_hash, result_summary, duration_ms, success)
									VALUES (
										${turnId},
										${toolName},
										${null},
										${(payload.result_summary as string | undefined) ?? null},
										${(payload.duration_ms as number | undefined) ?? null},
										${boolToInt(payload.success as boolean) ?? 0}
									)
								`;
							}
						}

						return turnId;
					}),
				)
				.pipe(
					Effect.annotateLogs("service", "DataStore"),
					Effect.mapError((e) =>
						e instanceof DataStoreError
							? e
							: new DataStoreError({ operation: "write", table: "turns", reason: extractSqlReason(e) }),
					),
				);

		const endSession = (
			ccSessionId: string,
			endedAt: string,
			endReason: string | null,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("endSession").pipe(Effect.annotateLogs({ ccSessionId, endReason }));
				yield* sql`UPDATE sessions SET ended_at = ${endedAt}, end_reason = ${endReason} WHERE cc_session_id = ${ccSessionId}`;
				// Match the loud-fail contract of writeSession/writeTurn: a missing
				// cc_session_id is a programmer error, not an idempotent no-op.
				const rows = yield* sql<{ changes: number }>`SELECT changes() as changes`;
				if (rows[0].changes === 0) {
					return yield* Effect.fail(
						new DataStoreError({
							operation: "write",
							table: "sessions",
							reason: `unknown cc_session_id: ${ccSessionId}`,
						}),
					);
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) =>
					e instanceof DataStoreError
						? e
						: new DataStoreError({ operation: "write", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const writeFailureSignature = (input: FailureSignatureWriteInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeFailureSignature").pipe(
					Effect.annotateLogs({ signatureHash: input.signatureHash, runId: input.runId }),
				);
				yield* sql`INSERT INTO failure_signatures (signature_hash, first_seen_run_id, first_seen_at, last_seen_at, occurrence_count) VALUES (${input.signatureHash}, ${input.runId}, ${input.seenAt}, ${input.seenAt}, 1) ON CONFLICT(signature_hash) DO UPDATE SET occurrence_count = occurrence_count + 1, last_seen_at = excluded.last_seen_at`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "failure_signatures", reason: extractSqlReason(e) }),
				),
			);

		const writeHypothesis = (input: HypothesisInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeHypothesis").pipe(Effect.annotateLogs({ sessionId: input.sessionId }));
				yield* sql`INSERT INTO hypotheses (session_id, content, created_turn_id, cited_test_error_id, cited_stack_frame_id) VALUES (${input.sessionId}, ${input.content}, ${input.createdTurnId ?? null}, ${input.citedTestErrorId ?? null}, ${input.citedStackFrameId ?? null})`;
				const rows = yield* sql<{ id: number }>`SELECT last_insert_rowid() as id`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "hypotheses", reason: extractSqlReason(e) }),
				),
			);

		const validateHypothesis = (input: ValidateHypothesisInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("validateHypothesis").pipe(
					Effect.annotateLogs({ id: input.id, outcome: input.outcome }),
				);
				yield* sql`UPDATE hypotheses SET validation_outcome = ${input.outcome}, validated_at = ${input.validatedAt}, validated_turn_id = ${input.validatedTurnId ?? null} WHERE id = ${input.id}`;
				const rows = yield* sql<{ changes: number }>`SELECT changes() as changes`;
				if (rows[0].changes === 0) {
					return yield* Effect.fail(
						new DataStoreError({
							operation: "write",
							table: "hypotheses",
							reason: `unknown hypothesis id: ${input.id}`,
						}),
					);
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) =>
					e instanceof DataStoreError
						? e
						: new DataStoreError({ operation: "write", table: "hypotheses", reason: extractSqlReason(e) }),
				),
			);

		const writeTddSession = (input: TddSessionInput): Effect.Effect<number, DataStoreError> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("writeTddSession").pipe(
							Effect.annotateLogs({ sessionId: input.sessionId, goal: input.goal }),
						);
						// INSERT OR IGNORE lets SQLite atomically skip the row when the
						// partial unique index (session_id, run_id WHERE run_id IS NOT NULL)
						// fires, instead of a SELECT-then-INSERT which is vulnerable to a
						// write-write race (two concurrent transactions can both SELECT empty
						// then both attempt INSERT before either commits).
						const rows = yield* sql<{ id: number }>`
							INSERT OR IGNORE INTO tdd_sessions (session_id, goal, started_at, parent_tdd_session_id, run_id)
							VALUES (
								${input.sessionId},
								${input.goal},
								${input.startedAt},
								${input.parentTddSessionId ?? null},
								${input.runId ?? null}
							)
							RETURNING id
						`;

						let tddSessionId: number;
						let isNewSession: boolean;

						if (rows.length > 0) {
							tddSessionId = rows[0].id;
							isNewSession = true;
						} else {
							// INSERT was ignored — only reachable when runId is provided and
							// a concurrent writer already committed the same (session_id, run_id).
							const existing = yield* sql<{ id: number }>`
								SELECT id FROM tdd_sessions
								WHERE session_id = ${input.sessionId} AND run_id = ${input.runId}
								LIMIT 1
							`;
							if (existing.length === 0) {
								return yield* Effect.fail(new Error("writeTddSession: INSERT was ignored but no existing row found"));
							}
							tddSessionId = existing[0].id;
							isNewSession = false;
						}

						// Open the initial `spike` phase in the same transaction as the
						// session row so `getCurrentTddPhase` returns Some immediately after
						// start and there is never a window where the session exists without
						// an open phase. Only insert for genuinely new sessions — retries
						// that return an existing id must not create a duplicate spike phase.
						if (isNewSession) {
							yield* sql`
								INSERT INTO tdd_phases
									(tdd_session_id, behavior_id, phase, started_at, transition_reason, parent_phase_id)
								VALUES
									(
										${tddSessionId},
										${null},
										${"spike"},
										${input.startedAt},
										${"opened by tdd_session_start"},
										${null}
									)
							`;
						}

						return tddSessionId;
					}),
				)
				.pipe(
					Effect.annotateLogs("service", "DataStore"),
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "tdd_sessions", reason: extractSqlReason(e) }),
					),
				);

		const endTddSession = (input: EndTddSessionInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("endTddSession").pipe(Effect.annotateLogs({ id: input.id, outcome: input.outcome }));
				yield* sql`
					UPDATE tdd_sessions
					SET ended_at = ${input.endedAt},
					    outcome = ${input.outcome},
					    summary_note_id = ${input.summaryNoteId ?? null}
					WHERE id = ${input.id}
				`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "tdd_sessions", reason: extractSqlReason(e) }),
				),
			);

		interface TddSessionStatusRow {
			ended_at: string | null;
			outcome: string | null;
		}

		const ensureTddSessionOpen = (
			sessionId: number,
		): Effect.Effect<void, DataStoreError | TddSessionNotFoundError | TddSessionAlreadyEndedError> =>
			Effect.gen(function* () {
				const rows = yield* sql<TddSessionStatusRow>`
					SELECT ended_at, outcome FROM tdd_sessions WHERE id = ${sessionId}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_sessions", reason: extractSqlReason(e) }),
					),
				);
				if (rows.length === 0) {
					return yield* Effect.fail(
						new TddSessionNotFoundError({ id: sessionId, reason: "no tdd_sessions row for that id" }),
					);
				}
				const row = rows[0];
				if (row.ended_at !== null) {
					return yield* Effect.fail(
						new TddSessionAlreadyEndedError({
							id: sessionId,
							endedAt: row.ended_at,
							outcome: (row.outcome ?? "abandoned") as "succeeded" | "blocked" | "abandoned",
						}),
					);
				}
			});

		const ensureTddSessionExists = (sessionId: number): Effect.Effect<void, DataStoreError | TddSessionNotFoundError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE id = ${sessionId}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_sessions", reason: extractSqlReason(e) }),
					),
				);
				if (rows.length === 0) {
					return yield* Effect.fail(
						new TddSessionNotFoundError({ id: sessionId, reason: "no tdd_sessions row for that id" }),
					);
				}
			});

		const createGoal = (
			input: CreateGoalInput,
		): Effect.Effect<GoalRow, DataStoreError | TddSessionNotFoundError | TddSessionAlreadyEndedError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("createGoal").pipe(
					Effect.annotateLogs({ sessionId: input.sessionId, goal: input.goal }),
				);
				yield* ensureTddSessionOpen(input.sessionId);
				const rows = yield* sql<{
					id: number;
					session_id: number;
					ordinal: number;
					goal: string;
					status: string;
					created_at: string;
				}>`
					INSERT INTO tdd_session_goals (session_id, ordinal, goal)
					SELECT ${input.sessionId},
					       COALESCE(MAX(ordinal), -1) + 1,
					       ${input.goal}
					FROM tdd_session_goals
					WHERE session_id = ${input.sessionId}
					RETURNING id, session_id, ordinal, goal, status, created_at
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				return goalRowFromDb(rows[0]);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const getGoal = (id: number): Effect.Effect<Option.Option<GoalRow>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{
					id: number;
					session_id: number;
					ordinal: number;
					goal: string;
					status: string;
					created_at: string;
				}>`
					SELECT id, session_id, ordinal, goal, status, created_at
					FROM tdd_session_goals
					WHERE id = ${id}
				`;
				return rows.length === 0 ? Option.none() : Option.some(goalRowFromDb(rows[0]));
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
				),
			);

		const updateGoal = (
			input: UpdateGoalInput,
		): Effect.Effect<
			GoalRow,
			DataStoreError | GoalNotFoundError | TddSessionAlreadyEndedError | IllegalStatusTransitionError
		> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("updateGoal").pipe(Effect.annotateLogs({ id: input.id }));
				const existing = yield* sql<{
					id: number;
					session_id: number;
					ordinal: number;
					goal: string;
					status: string;
					created_at: string;
				}>`
					SELECT id, session_id, ordinal, goal, status, created_at
					FROM tdd_session_goals
					WHERE id = ${input.id}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				if (existing.length === 0) {
					return yield* Effect.fail(
						new GoalNotFoundError({ id: input.id, reason: "no tdd_session_goals row for that id" }),
					);
				}
				const current = existing[0];
				yield* ensureTddSessionOpen(current.session_id).pipe(
					Effect.catchTag("TddSessionNotFoundError", (e) =>
						Effect.fail(
							new DataStoreError({
								operation: "read",
								table: "tdd_sessions",
								reason: `FK integrity violation: goal ${input.id} references missing tdd_sessions row ${e.id}`,
							}),
						),
					),
				);
				const fromStatus = current.status as GoalStatus;
				const toStatus = input.status ?? fromStatus;
				if (input.status !== undefined && !isLegalLifecycleTransition(fromStatus, input.status)) {
					return yield* Effect.fail(
						new IllegalStatusTransitionError({
							entity: "goal",
							id: input.id,
							from: fromStatus,
							to: input.status,
							reason: "transition forbidden by goal lifecycle rules",
						}),
					);
				}
				const newGoalText = input.goal ?? current.goal;
				yield* sql`
					UPDATE tdd_session_goals
					SET goal = ${newGoalText},
					    status = ${toStatus}
					WHERE id = ${input.id}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				return {
					id: current.id,
					sessionId: current.session_id,
					ordinal: current.ordinal,
					goal: newGoalText,
					status: toStatus,
					createdAt: current.created_at,
				};
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const deleteGoal = (id: number): Effect.Effect<void, DataStoreError | GoalNotFoundError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("deleteGoal").pipe(Effect.annotateLogs({ id }));
				const existing = yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE id = ${id}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				if (existing.length === 0) {
					return yield* Effect.fail(new GoalNotFoundError({ id, reason: "no tdd_session_goals row for that id" }));
				}
				yield* sql`DELETE FROM tdd_session_goals WHERE id = ${id}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const listGoalsBySession = (
			sessionId: number,
		): Effect.Effect<ReadonlyArray<GoalRow>, DataStoreError | TddSessionNotFoundError> =>
			Effect.gen(function* () {
				yield* ensureTddSessionExists(sessionId);
				const rows = yield* sql<{
					id: number;
					session_id: number;
					ordinal: number;
					goal: string;
					status: string;
					created_at: string;
				}>`
					SELECT id, session_id, ordinal, goal, status, created_at
					FROM tdd_session_goals
					WHERE session_id = ${sessionId}
					ORDER BY ordinal
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				return rows.map(goalRowFromDb);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		interface GoalLifecycleRow {
			id: number;
			session_id: number;
			status: string;
		}

		const ensureGoalOpenAndSessionOpen = (
			goalId: number,
		): Effect.Effect<
			{ goalSessionId: number; goalStatus: BehaviorStatus },
			DataStoreError | GoalNotFoundError | TddSessionAlreadyEndedError | IllegalStatusTransitionError
		> =>
			Effect.gen(function* () {
				const goals = yield* sql<GoalLifecycleRow>`
					SELECT id, session_id, status FROM tdd_session_goals WHERE id = ${goalId}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				if (goals.length === 0) {
					return yield* Effect.fail(new GoalNotFoundError({ id: goalId, reason: "no tdd_session_goals row" }));
				}
				const goal = goals[0];
				yield* ensureTddSessionOpen(goal.session_id).pipe(
					Effect.catchTag("TddSessionNotFoundError", (e) =>
						Effect.fail(
							new DataStoreError({
								operation: "read",
								table: "tdd_sessions",
								reason: `FK integrity violation: goal ${goalId} references missing tdd_sessions row ${e.id}`,
							}),
						),
					),
				);
				if (goal.status === "done" || goal.status === "abandoned") {
					return yield* Effect.fail(
						new IllegalStatusTransitionError({
							entity: "goal",
							id: goalId,
							from: goal.status,
							to: "in_progress",
							reason: "cannot create a behavior under a closed goal",
						}),
					);
				}
				return { goalSessionId: goal.session_id, goalStatus: goal.status as BehaviorStatus };
			});

		const writeBehaviorDependencies = (behaviorId: number, goalId: number, depIds: ReadonlyArray<number>) =>
			Effect.gen(function* () {
				const uniqueDepIds = Array.from(new Set(depIds));
				if (uniqueDepIds.length === 0) return;
				const verified = yield* sql<{ id: number }>`
					SELECT id FROM tdd_session_behaviors
					WHERE goal_id = ${goalId} AND id IN ${sql.in(uniqueDepIds)}
				`.pipe(
					Effect.mapError(
						(e) =>
							new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
					),
				);
				const verifiedIds = new Set(verified.map((r) => r.id));
				for (const depId of uniqueDepIds) {
					if (!verifiedIds.has(depId)) {
						return yield* Effect.fail(
							new BehaviorNotFoundError({
								id: depId,
								reason: `dependency id ${depId} does not belong to goal ${goalId}`,
							}),
						);
					}
				}
				for (const depId of uniqueDepIds) {
					yield* sql`
						INSERT INTO tdd_behavior_dependencies (behavior_id, depends_on_id)
						VALUES (${behaviorId}, ${depId})
					`.pipe(
						Effect.mapError(
							(e) =>
								new DataStoreError({
									operation: "write",
									table: "tdd_behavior_dependencies",
									reason: extractSqlReason(e),
								}),
						),
					);
				}
			});

		const createBehavior = (
			input: CreateBehaviorInput,
		): Effect.Effect<
			BehaviorRow,
			| DataStoreError
			| GoalNotFoundError
			| BehaviorNotFoundError
			| TddSessionAlreadyEndedError
			| IllegalStatusTransitionError
		> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("createBehavior").pipe(
							Effect.annotateLogs({ goalId: input.goalId, behavior: input.behavior }),
						);
						yield* ensureGoalOpenAndSessionOpen(input.goalId);
						const rows = yield* sql<{
							id: number;
							goal_id: number;
							ordinal: number;
							behavior: string;
							suggested_test_name: string | null;
							status: string;
							created_at: string;
						}>`
							INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior, suggested_test_name)
							SELECT ${input.goalId},
							       COALESCE(MAX(ordinal), -1) + 1,
							       ${input.behavior},
							       ${input.suggestedTestName ?? null}
							FROM tdd_session_behaviors
							WHERE goal_id = ${input.goalId}
							RETURNING id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
						`.pipe(
							Effect.mapError(
								(e) =>
									new DataStoreError({
										operation: "write",
										table: "tdd_session_behaviors",
										reason: extractSqlReason(e),
									}),
							),
						);
						const beh = rows[0];
						if (input.dependsOnBehaviorIds && input.dependsOnBehaviorIds.length > 0) {
							yield* writeBehaviorDependencies(beh.id, input.goalId, input.dependsOnBehaviorIds);
						}
						return behaviorRowFromDb(beh);
					}),
				)
				.pipe(
					Effect.annotateLogs("service", "DataStore"),
					Effect.mapError((e) =>
						e instanceof DataStoreError ||
						e instanceof GoalNotFoundError ||
						e instanceof BehaviorNotFoundError ||
						e instanceof TddSessionAlreadyEndedError ||
						e instanceof IllegalStatusTransitionError
							? e
							: new DataStoreError({
									operation: "write",
									table: "tdd_session_behaviors",
									reason: extractSqlReason(e),
								}),
					),
				);

		const getBehavior = (id: number): Effect.Effect<Option.Option<BehaviorRow>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{
					id: number;
					goal_id: number;
					ordinal: number;
					behavior: string;
					suggested_test_name: string | null;
					status: string;
					created_at: string;
				}>`
					SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
					FROM tdd_session_behaviors
					WHERE id = ${id}
				`;
				return rows.length === 0 ? Option.none() : Option.some(behaviorRowFromDb(rows[0]));
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
				),
			);

		const updateBehavior = (
			input: UpdateBehaviorInput,
		): Effect.Effect<
			BehaviorRow,
			DataStoreError | BehaviorNotFoundError | TddSessionAlreadyEndedError | IllegalStatusTransitionError
		> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("updateBehavior").pipe(Effect.annotateLogs({ id: input.id }));
						const existing = yield* sql<{
							id: number;
							goal_id: number;
							ordinal: number;
							behavior: string;
							suggested_test_name: string | null;
							status: string;
							created_at: string;
						}>`
							SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
							FROM tdd_session_behaviors
							WHERE id = ${input.id}
						`.pipe(
							Effect.mapError(
								(e) =>
									new DataStoreError({
										operation: "read",
										table: "tdd_session_behaviors",
										reason: extractSqlReason(e),
									}),
							),
						);
						if (existing.length === 0) {
							return yield* Effect.fail(
								new BehaviorNotFoundError({ id: input.id, reason: "no tdd_session_behaviors row for that id" }),
							);
						}
						const current = existing[0];
						const goalRows = yield* sql<{ session_id: number }>`
							SELECT session_id FROM tdd_session_goals WHERE id = ${current.goal_id}
						`.pipe(
							Effect.mapError(
								(e) =>
									new DataStoreError({
										operation: "read",
										table: "tdd_session_goals",
										reason: extractSqlReason(e),
									}),
							),
						);
						if (goalRows.length === 0) {
							return yield* Effect.fail(
								new DataStoreError({
									operation: "read",
									table: "tdd_session_goals",
									reason: `FK integrity violation: behavior ${input.id} references missing tdd_session_goals row ${current.goal_id}`,
								}),
							);
						}
						yield* ensureTddSessionOpen(goalRows[0].session_id).pipe(
							Effect.catchTag("TddSessionNotFoundError", (e) =>
								Effect.fail(
									new DataStoreError({
										operation: "read",
										table: "tdd_sessions",
										reason: `FK integrity violation: goal ${current.goal_id} references missing tdd_sessions row ${e.id}`,
									}),
								),
							),
						);
						const fromStatus = current.status as BehaviorStatus;
						if (input.status !== undefined && !isLegalLifecycleTransition(fromStatus, input.status)) {
							return yield* Effect.fail(
								new IllegalStatusTransitionError({
									entity: "behavior",
									id: input.id,
									from: fromStatus,
									to: input.status,
									reason: "transition forbidden by behavior lifecycle rules",
								}),
							);
						}
						const newBehaviorText = input.behavior ?? current.behavior;
						const newStatus = input.status ?? fromStatus;
						const newSuggested =
							input.suggestedTestName === undefined ? current.suggested_test_name : input.suggestedTestName;
						yield* sql`
							UPDATE tdd_session_behaviors
							SET behavior = ${newBehaviorText},
							    suggested_test_name = ${newSuggested},
							    status = ${newStatus}
							WHERE id = ${input.id}
						`.pipe(
							Effect.mapError(
								(e) =>
									new DataStoreError({
										operation: "write",
										table: "tdd_session_behaviors",
										reason: extractSqlReason(e),
									}),
							),
						);
						if (input.dependsOnBehaviorIds !== undefined) {
							yield* sql`DELETE FROM tdd_behavior_dependencies WHERE behavior_id = ${input.id}`.pipe(
								Effect.mapError(
									(e) =>
										new DataStoreError({
											operation: "write",
											table: "tdd_behavior_dependencies",
											reason: extractSqlReason(e),
										}),
								),
							);
							if (input.dependsOnBehaviorIds.length > 0) {
								yield* writeBehaviorDependencies(input.id, current.goal_id, input.dependsOnBehaviorIds);
							}
						}
						return {
							id: current.id,
							goalId: current.goal_id,
							ordinal: current.ordinal,
							behavior: newBehaviorText,
							suggestedTestName: newSuggested,
							status: newStatus,
							createdAt: current.created_at,
						};
					}),
				)
				.pipe(
					Effect.annotateLogs("service", "DataStore"),
					Effect.mapError((e) =>
						e instanceof DataStoreError ||
						e instanceof BehaviorNotFoundError ||
						e instanceof TddSessionAlreadyEndedError ||
						e instanceof IllegalStatusTransitionError
							? e
							: new DataStoreError({
									operation: "write",
									table: "tdd_session_behaviors",
									reason: extractSqlReason(e),
								}),
					),
				);

		const deleteBehavior = (id: number): Effect.Effect<void, DataStoreError | BehaviorNotFoundError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("deleteBehavior").pipe(Effect.annotateLogs({ id }));
				const existing = yield* sql<{ id: number }>`SELECT id FROM tdd_session_behaviors WHERE id = ${id}`.pipe(
					Effect.mapError(
						(e) =>
							new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
					),
				);
				if (existing.length === 0) {
					return yield* Effect.fail(
						new BehaviorNotFoundError({ id, reason: "no tdd_session_behaviors row for that id" }),
					);
				}
				yield* sql`DELETE FROM tdd_session_behaviors WHERE id = ${id}`.pipe(
					Effect.mapError(
						(e) =>
							new DataStoreError({ operation: "write", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
					),
				);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const ensureGoalExists = (goalId: number): Effect.Effect<void, DataStoreError | GoalNotFoundError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE id = ${goalId}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
					),
				);
				if (rows.length === 0) {
					return yield* Effect.fail(new GoalNotFoundError({ id: goalId, reason: "no tdd_session_goals row" }));
				}
			});

		const listBehaviorsByGoal = (
			goalId: number,
		): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError | GoalNotFoundError> =>
			Effect.gen(function* () {
				yield* ensureGoalExists(goalId);
				const rows = yield* sql<{
					id: number;
					goal_id: number;
					ordinal: number;
					behavior: string;
					suggested_test_name: string | null;
					status: string;
					created_at: string;
				}>`
					SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
					FROM tdd_session_behaviors
					WHERE goal_id = ${goalId}
					ORDER BY ordinal
				`.pipe(
					Effect.mapError(
						(e) =>
							new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
					),
				);
				return rows.map(behaviorRowFromDb);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const listBehaviorsBySession = (
			sessionId: number,
		): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError | TddSessionNotFoundError> =>
			Effect.gen(function* () {
				yield* ensureTddSessionExists(sessionId);
				const rows = yield* sql<{
					id: number;
					goal_id: number;
					ordinal: number;
					behavior: string;
					suggested_test_name: string | null;
					status: string;
					created_at: string;
				}>`
					SELECT b.id, b.goal_id, b.ordinal, b.behavior, b.suggested_test_name, b.status, b.created_at
					FROM tdd_session_behaviors b
					JOIN tdd_session_goals g ON g.id = b.goal_id
					WHERE g.session_id = ${sessionId}
					ORDER BY g.ordinal, b.ordinal
				`.pipe(
					Effect.mapError(
						(e) =>
							new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
					),
				);
				return rows.map(behaviorRowFromDb);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const writeTddArtifact = (input: WriteTddArtifactInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeTddArtifact").pipe(
					Effect.annotateLogs({ phaseId: input.phaseId, artifactKind: input.artifactKind }),
				);
				const truncatedDiff =
					input.diffExcerpt !== undefined && input.diffExcerpt.length > 4096
						? input.diffExcerpt.slice(0, 4096)
						: (input.diffExcerpt ?? null);
				const rows = yield* sql<{ id: number }>`
					INSERT INTO tdd_artifacts
						(phase_id, artifact_kind, file_id, test_case_id, test_run_id,
						 test_first_failure_run_id, diff_excerpt, recorded_at)
					VALUES
						(
							${input.phaseId},
							${input.artifactKind},
							${input.fileId ?? null},
							${input.testCaseId ?? null},
							${input.testRunId ?? null},
							${input.testFirstFailureRunId ?? null},
							${truncatedDiff},
							${input.recordedAt}
						)
					RETURNING id
				`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "tdd_artifacts", reason: extractSqlReason(e) }),
				),
			);

		const writeTddPhase = (input: WriteTddPhaseInput): Effect.Effect<WriteTddPhaseOutput, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeTddPhase").pipe(
					Effect.annotateLogs({ tddSessionId: input.tddSessionId, phase: input.phase }),
				);

				// Find the currently-open phase (ended_at IS NULL) for this session,
				// if any, so we can close it as we open the new one.
				const open = yield* sql<{ id: number }>`
					SELECT id FROM tdd_phases
					WHERE tdd_session_id = ${input.tddSessionId} AND ended_at IS NULL
					ORDER BY started_at DESC LIMIT 1
				`;
				const previousPhaseId = open.length === 0 ? null : open[0].id;

				if (previousPhaseId !== null) {
					yield* sql`
						UPDATE tdd_phases SET ended_at = ${input.startedAt}
						WHERE id = ${previousPhaseId}
					`;
				}

				const rows = yield* sql<{ id: number }>`
					INSERT INTO tdd_phases
						(tdd_session_id, behavior_id, phase, started_at, transition_reason, parent_phase_id)
					VALUES
						(
							${input.tddSessionId},
							${input.behaviorId ?? null},
							${input.phase},
							${input.startedAt},
							${input.transitionReason ?? null},
							${input.parentPhaseId ?? null}
						)
					RETURNING id
				`;
				return { id: rows[0].id, previousPhaseId };
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "tdd_phases", reason: extractSqlReason(e) }),
				),
			);

		const writeCommit = (input: WriteCommitInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeCommit").pipe(Effect.annotateLogs({ sha: input.sha }));
				yield* sql`
					INSERT INTO commits (sha, parent_sha, message, author, committed_at, branch)
					VALUES (
						${input.sha},
						${input.parentSha ?? null},
						${input.message ?? null},
						${input.author ?? null},
						${input.committedAt ?? null},
						${input.branch ?? null}
					)
					ON CONFLICT(sha) DO NOTHING
				`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "commits", reason: extractSqlReason(e) }),
				),
			);

		const writeRunChangedFiles = (input: WriteRunChangedFilesInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeRunChangedFiles").pipe(
					Effect.annotateLogs({ runId: input.runId, count: input.files.length }),
				);
				for (const file of input.files) {
					const fileId = yield* ensureFile(file.filePath);
					yield* sql`
						INSERT INTO run_changed_files (run_id, file_id, change_kind, commit_sha)
						VALUES (${input.runId}, ${fileId}, ${file.changeKind}, ${file.commitSha ?? null})
						ON CONFLICT(run_id, file_id) DO UPDATE SET
							change_kind = excluded.change_kind,
							commit_sha = excluded.commit_sha
					`;
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) =>
						new DataStoreError({
							operation: "write",
							table: "run_changed_files",
							reason: extractSqlReason(e),
						}),
				),
			);

		const recordIdempotentResponse = (input: IdempotentResponseInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("recordIdempotentResponse").pipe(
					Effect.annotateLogs({ procedurePath: input.procedurePath, key: input.key }),
				);
				yield* sql`INSERT INTO mcp_idempotent_responses (procedure_path, key, result_json, created_at) VALUES (${input.procedurePath}, ${input.key}, ${input.resultJson}, ${input.createdAt}) ON CONFLICT(procedure_path, key) DO NOTHING`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) =>
						new DataStoreError({
							operation: "write",
							table: "mcp_idempotent_responses",
							reason: extractSqlReason(e),
						}),
				),
			);

		const pruneSessions = (
			keepRecent: number,
		): Effect.Effect<{ readonly affectedSessions: number; readonly prunedTurns: number }, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("pruneSessions").pipe(Effect.annotateLogs({ keepRecent }));

				// Find the cutoff timestamp: started_at of the (keepRecent+1)-th
				// newest session. If fewer sessions exist, there is nothing to prune.
				const cutoffRows = yield* sql<{ started_at: string }>`
					SELECT started_at FROM sessions ORDER BY started_at DESC LIMIT 1 OFFSET ${keepRecent}
				`;
				if (cutoffRows.length === 0) return { affectedSessions: 0, prunedTurns: 0 };
				const cutoff = cutoffRows[0].started_at;

				const turnCountRows = yield* sql<{ count: number }>`
					SELECT COUNT(*) AS count FROM turns
					WHERE session_id IN (SELECT id FROM sessions WHERE started_at <= ${cutoff})
				`;
				const prunedTurns = turnCountRows[0]?.count ?? 0;

				// `affectedSessions` is the number of sessions whose turn-log was
				// dropped, NOT sessions deleted: sessions rows are retained so the
				// summary remains queryable. Naming reflects that distinction.
				const sessionCountRows = yield* sql<{ count: number }>`
					SELECT COUNT(*) AS count FROM sessions WHERE started_at <= ${cutoff}
				`;
				const affectedSessions = sessionCountRows[0]?.count ?? 0;

				// FK CASCADE on tool_invocations.turn_id and file_edits.turn_id
				// drops the children when these turns rows go. The sessions rows
				// themselves stay so the summary remains queryable.
				yield* sql`
					DELETE FROM turns WHERE session_id IN (
						SELECT id FROM sessions WHERE started_at <= ${cutoff}
					)
				`;

				return { affectedSessions, prunedTurns };
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError((e) => new DataStoreError({ operation: "write", table: "turns", reason: extractSqlReason(e) })),
			);

		const associateLatestRunWithSession = (input: {
			ccSessionId: string;
			invocationMethod: string;
		}): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("associateLatestRunWithSession").pipe(
					Effect.annotateLogs({ ccSessionId: input.ccSessionId, invocationMethod: input.invocationMethod }),
				);
				// Single INSERT: CROSS JOIN ensures a no-op when either the latest run
				// or the session lookup returns no rows. INSERT OR IGNORE skips if the
				// run already has a trigger row.
				yield* sql`
					INSERT OR IGNORE INTO run_triggers (run_id, trigger, invocation_method, agent_session_id)
					SELECT r.id, 'agent', ${input.invocationMethod}, s.id
					FROM (SELECT id FROM test_runs ORDER BY id DESC LIMIT 1) r
					CROSS JOIN (SELECT id FROM sessions WHERE cc_session_id = ${input.ccSessionId} LIMIT 1) s
				`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "run_triggers", reason: extractSqlReason(e) }),
				),
			);

		const backfillTestCaseTurns = (ccSessionId: string): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("backfillTestCaseTurns").pipe(Effect.annotateLogs({ ccSessionId }));
				// For each test case in the latest run whose module file was edited
				// in the given session, set created_turn_id to the most recent such
				// edit's turn. Uses LIKE suffix-matching because the reporter stores
				// relative paths (packages/foo/bar.test.ts) while hooks store absolute
				// paths (/abs/path/packages/foo/bar.test.ts).
				yield* sql`
					UPDATE test_cases
					SET created_turn_id = (
						SELECT t.id
						FROM turns t
						JOIN file_edits fe ON fe.turn_id = t.id
						JOIN files f_edit ON fe.file_id = f_edit.id
						JOIN sessions s ON t.session_id = s.id
						WHERE s.cc_session_id = ${ccSessionId}
						  AND EXISTS (
							SELECT 1
							FROM test_modules tm
							JOIN files f_mod ON f_mod.id = tm.file_id
							WHERE tm.id = test_cases.module_id
							  AND (
								f_edit.path = f_mod.path
								OR f_edit.path LIKE '%/' || f_mod.path
								OR f_mod.path LIKE '%/' || f_edit.path
							  )
						  )
						ORDER BY t.occurred_at DESC
						LIMIT 1
					)
					WHERE test_cases.created_turn_id IS NULL
					  AND test_cases.module_id IN (
						SELECT id FROM test_modules
						WHERE run_id = (SELECT id FROM test_runs ORDER BY id DESC LIMIT 1)
					  )
				`;
				const changesRows = yield* sql<{ n: number }>`SELECT changes() AS n`;
				return changesRows[0]?.n ?? 0;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "test_cases", reason: extractSqlReason(e) }),
				),
			);

		return {
			ensureFile,
			writeSettings,
			writeRun,
			writeModules,
			writeSuites,
			writeTestCases,
			writeErrors,
			writeCoverage,
			writeHistory,
			writeBaselines,
			writeTrends,
			writeSourceMap,
			writeNote,
			updateNote,
			deleteNote,
			writeSession,
			writeTurn,
			writeFailureSignature,
			endSession,
			writeHypothesis,
			validateHypothesis,
			writeTddSession,
			endTddSession,
			createGoal,
			getGoal,
			updateGoal,
			deleteGoal,
			listGoalsBySession,
			createBehavior,
			getBehavior,
			updateBehavior,
			deleteBehavior,
			listBehaviorsByGoal,
			listBehaviorsBySession,
			writeTddPhase,
			writeTddArtifact,
			writeCommit,
			writeRunChangedFiles,
			recordIdempotentResponse,
			pruneSessions,
			associateLatestRunWithSession,
			backfillTestCaseTurns,
		};
	}),
);
