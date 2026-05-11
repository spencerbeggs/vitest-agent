import { randomUUID } from "node:crypto";
import { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Layer, Option } from "effect";
import { AgentNotFoundError, RegistrationConflictError } from "../errors/AgentErrors.js";
import { DataStoreError, extractSqlReason } from "../errors/DataStoreError.js";
import {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "../errors/TddErrors.js";
import { Agent, IdempotencyHit } from "../schemas/Agent.js";
import type { CoverageBaselines } from "../schemas/Baselines.js";
import type { BehaviorRow, BehaviorStatus, GoalRow, GoalStatus } from "../schemas/Tdd.js";
import type { TrendEntry } from "../schemas/Trends.js";
import type {
	CreateBehaviorInput,
	CreateGoalInput,
	EndTddTaskInput,
	FailureSignatureWriteInput,
	FileCoverageInput,
	HypothesisInput,
	IdempotentResponseInput,
	ModuleInput,
	NoteInput,
	RegisterAgentInput,
	SessionInput,
	SettingsInput,
	SuiteInput,
	TddTaskInput,
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
				yield* sql`INSERT OR IGNORE INTO settings (hash, vitest_version, pool, environment, test_timeout, hook_timeout, slow_test_threshold, max_concurrency, max_workers, isolate, bail, globals, file_parallelism, sequence_seed, coverage_provider) VALUES (${hash}, ${settings.vitestVersion}, ${settings.pool ?? null}, ${settings.environment ?? null}, ${settings.testTimeout ?? null}, ${settings.hookTimeout ?? null}, ${settings.slowTestThreshold ?? null}, ${settings.maxConcurrency ?? null}, ${settings.maxWorkers ?? null}, ${boolToInt(settings.isolate)}, ${settings.bail ?? null}, ${boolToInt(settings.globals)}, ${boolToInt(settings.fileParallelism)}, ${settings.sequenceSeed ?? null}, ${settings.coverageProvider ?? null})`;

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
				const actorType = input.actorType ?? "system";
				const agentId = input.agentId ?? null;
				const conversationId = input.conversationId ?? null;
				const gitDirtyInt = input.gitDirty === undefined || input.gitDirty === null ? null : input.gitDirty ? 1 : 0;
				const hostMetadataJson = input.hostMetadata == null ? null : JSON.stringify(input.hostMetadata);
				yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, commit_sha, branch, reason, duration, total, passed, failed, skipped, scoped, snapshot_added, snapshot_matched, snapshot_unmatched, snapshot_updated, snapshot_unchecked, snapshot_total, snapshot_failure, snapshot_did_update, snapshot_files_added, snapshot_files_removed, snapshot_files_unmatched, snapshot_files_updated, actor_type, agent_id, conversation_id, git_branch, git_commit_sha, git_dirty, git_upstream, git_worktree_dir, host_source, host_value, host_metadata) VALUES (${input.invocationId}, ${input.project}, ${input.settingsHash}, ${input.timestamp}, ${input.commitSha ?? null}, ${input.branch ?? null}, ${input.reason}, ${input.duration}, ${input.total}, ${input.passed}, ${input.failed}, ${input.skipped}, ${input.scoped ? 1 : 0}, ${input.snapshotAdded ?? 0}, ${input.snapshotMatched ?? 0}, ${input.snapshotUnmatched ?? 0}, ${input.snapshotUpdated ?? 0}, ${input.snapshotUnchecked ?? 0}, ${input.snapshotTotal ?? 0}, ${boolToInt(input.snapshotFailure) ?? 0}, ${boolToInt(input.snapshotDidUpdate) ?? 0}, ${input.snapshotFilesAdded ?? 0}, ${input.snapshotFilesRemoved ?? 0}, ${input.snapshotFilesUnmatched ?? 0}, ${input.snapshotFilesUpdated ?? 0}, ${actorType}, ${agentId}, ${conversationId}, ${input.gitBranch ?? null}, ${input.gitCommitSha ?? null}, ${gitDirtyInt}, ${input.gitUpstream ?? null}, ${input.gitWorktreeDir ?? null}, ${input.hostSource ?? null}, ${input.hostValue ?? null}, ${hostMetadataJson})`;
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
					yield* sql`INSERT INTO test_cases (module_id, suite_id, vitest_id, name, full_name, state, classification, duration, start_time, flaky, slow, retry_count, repeat_count, heap, mode, each, fails, concurrent, shuffle, timeout, skip_note, location_line, location_column, created_turn_id) VALUES (${moduleId}, ${tc.suiteId ?? null}, ${tc.vitestId ?? null}, ${tc.name}, ${tc.fullName}, ${tc.state}, ${tc.classification ?? null}, ${tc.duration ?? null}, ${tc.startTime ?? null}, ${boolToInt(tc.flaky)}, ${boolToInt(tc.slow)}, ${tc.retryCount ?? 0}, ${tc.repeatCount ?? 0}, ${tc.heap ?? null}, ${tc.mode ?? null}, ${boolToInt(tc.each)}, ${boolToInt(tc.fails)}, ${boolToInt(tc.concurrent)}, ${boolToInt(tc.shuffle)}, ${tc.timeout ?? null}, ${tc.skipNote ?? null}, ${tc.locationLine ?? null}, ${tc.locationColumn ?? null}, ${tc.createdTurnId ?? null})`;
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
				yield* Effect.logDebug("writeHistory").pipe(Effect.annotateLogs({ project, runId }));
				yield* sql`INSERT INTO test_history (run_id, project, full_name, timestamp, state, duration, flaky, retry_count, error_message) VALUES (${runId}, ${project}, ${fullName}, ${timestamp}, ${state}, ${duration}, ${flaky ? 1 : 0}, ${retryCount}, ${errorMessage})`;

				// Delete oldest entries beyond 10-entry window per (project, fullName)
				yield* sql`DELETE FROM test_history WHERE id NOT IN (SELECT id FROM test_history WHERE project = ${project} AND full_name = ${fullName} ORDER BY timestamp DESC LIMIT 10) AND project = ${project} AND full_name = ${fullName}`;
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
						yield* sql`INSERT INTO coverage_baselines (project, metric, value, pattern, updated_at) VALUES ('__global__', ${metric}, ${value}, '', ${updatedAt}) ON CONFLICT (project, metric, pattern) DO UPDATE SET value = ${value}, updated_at = ${updatedAt}`;
					}
				}

				// Upsert pattern metrics
				for (const [pattern, thresholds] of patterns) {
					for (const metric of metrics) {
						const value = thresholds[metric];
						if (value !== undefined) {
							yield* sql`INSERT INTO coverage_baselines (project, metric, value, pattern, updated_at) VALUES ('__global__', ${metric}, ${value}, ${pattern}, ${updatedAt}) ON CONFLICT (project, metric, pattern) DO UPDATE SET value = ${value}, updated_at = ${updatedAt}`;
						}
					}
				}
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "coverage_baselines", reason: extractSqlReason(e) }),
				),
			);

		const writeTrends = (project: string, runId: number, entry: TrendEntry): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("writeTrends").pipe(Effect.annotateLogs({ project, runId }));
				yield* sql`INSERT OR REPLACE INTO coverage_trends (run_id, project, timestamp, lines, functions, branches, statements, direction, targets_hash) VALUES (${runId}, ${project}, ${entry.timestamp}, ${entry.coverage.lines}, ${entry.coverage.functions}, ${entry.coverage.branches}, ${entry.coverage.statements}, ${entry.direction}, ${entry.targetsHash ?? null})`;

				// Delete oldest entries beyond 50-entry window per (project)
				yield* sql`DELETE FROM coverage_trends WHERE id NOT IN (SELECT id FROM coverage_trends WHERE project = ${project} ORDER BY timestamp DESC LIMIT 50) AND project = ${project}`;
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
				yield* sql`INSERT INTO notes (title, content, scope, project, test_full_name, module_path, parent_note_id, created_by, expires_at, pinned) VALUES (${note.title}, ${note.content}, ${note.scope}, ${note.project ?? null}, ${note.testFullName ?? null}, ${note.modulePath ?? null}, ${note.parentNoteId ?? null}, ${note.createdBy ?? null}, ${note.expiresAt ?? null}, ${note.pinned ? 1 : 0})`;
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
				yield* Effect.logDebug("writeSession").pipe(Effect.annotateLogs({ chatId: input.chatId }));
				yield* sql`INSERT INTO sessions (chat_id, project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at) VALUES (${input.chatId}, ${input.project}, ${input.cwd}, ${input.agentKind}, ${input.agentType ?? null}, ${input.parentSessionId ?? null}, ${boolToInt(input.triageWasNonEmpty) ?? 0}, ${input.startedAt})`;
				const rows = yield* sql<{ id: number }>`SELECT id FROM sessions WHERE chat_id = ${input.chatId}`;
				return rows[0].id;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const upsertSession = (input: SessionInput): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("upsertSession").pipe(Effect.annotateLogs({ chatId: input.chatId }));
				yield* sql`INSERT INTO sessions (chat_id, project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at) VALUES (${input.chatId}, ${input.project}, ${input.cwd}, ${input.agentKind}, ${input.agentType ?? null}, ${input.parentSessionId ?? null}, ${boolToInt(input.triageWasNonEmpty) ?? 0}, ${input.startedAt}) ON CONFLICT(chat_id) DO NOTHING`;
				const rows = yield* sql<{ id: number }>`SELECT id FROM sessions WHERE chat_id = ${input.chatId}`;
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
							Effect.annotateLogs({ sessionId: input.sessionId, type: input.type }),
						);
						if (input.turnNo !== undefined) {
							yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${input.sessionId}, ${input.turnNo}, ${input.type}, ${input.payload}, ${input.occurredAt})`;
						} else {
							// Atomic auto-assignment: compute next turn_no inside the same INSERT
							// so concurrent writers can't both compute the same value before either
							// inserts. UNIQUE(session_id, turn_no) is enforced by the schema as a
							// safety net.
							yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) SELECT ${input.sessionId}, COALESCE(MAX(turn_no), 0) + 1, ${input.type}, ${input.payload}, ${input.occurredAt} FROM turns WHERE session_id = ${input.sessionId}`;
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
			chatId: string,
			endedAt: string,
			endReason: string | null,
		): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("endSession").pipe(Effect.annotateLogs({ chatId, endReason }));
				yield* sql`UPDATE sessions SET ended_at = ${endedAt}, end_reason = ${endReason} WHERE chat_id = ${chatId}`;
				// Match the loud-fail contract of writeSession/writeTurn: a missing
				// chat_id is a programmer error, not an idempotent no-op.
				const rows = yield* sql<{ changes: number }>`SELECT changes() as changes`;
				if (rows[0].changes === 0) {
					return yield* Effect.fail(
						new DataStoreError({
							operation: "write",
							table: "sessions",
							reason: `unknown chat_id: ${chatId}`,
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

		const writeTddTask = (input: TddTaskInput): Effect.Effect<number, DataStoreError> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("writeTddTask").pipe(
							Effect.annotateLogs({ sessionId: input.sessionId, goal: input.goal }),
						);
						// INSERT OR IGNORE lets SQLite atomically skip the row when the
						// partial unique index (session_id, run_id WHERE run_id IS NOT NULL)
						// fires, instead of a SELECT-then-INSERT which is vulnerable to a
						// write-write race (two concurrent transactions can both SELECT empty
						// then both attempt INSERT before either commits).
						const rows = yield* sql<{ id: number }>`
							INSERT OR IGNORE INTO tdd_tasks (session_id, goal, started_at, parent_tdd_task_id, run_id)
							VALUES (
								${input.sessionId},
								${input.goal},
								${input.startedAt},
								${input.parentTddTaskId ?? null},
								${input.runId ?? null}
							)
							RETURNING id
						`;

						let tddTaskId: number;
						let isNewTask: boolean;

						if (rows.length > 0) {
							tddTaskId = rows[0].id;
							isNewTask = true;
						} else {
							// INSERT was ignored — only reachable when runId is provided and
							// a concurrent writer already committed the same (session_id, run_id).
							const existing = yield* sql<{ id: number; goal: string }>`
								SELECT id, goal FROM tdd_tasks
								WHERE session_id = ${input.sessionId} AND run_id = ${input.runId}
								LIMIT 1
							`;
							if (existing.length === 0) {
								return yield* Effect.fail(new Error("writeTddTask: INSERT was ignored but no existing row found"));
							}
							if (existing[0].goal !== input.goal) {
								return yield* Effect.fail(
									new Error(
										`writeTddTask: runId conflict — existing task has goal "${existing[0].goal}", caller provided "${input.goal}"`,
									),
								);
							}
							tddTaskId = existing[0].id;
							isNewTask = false;
						}

						// Open the initial `spike` phase in the same transaction as the
						// task row so `getCurrentTddPhase` returns Some immediately after
						// start and there is never a window where the task exists without
						// an open phase. Only insert for genuinely new tasks — retries
						// that return an existing id must not create a duplicate spike phase.
						if (isNewTask) {
							yield* sql`
								INSERT INTO tdd_phases
									(tdd_task_id, behavior_id, phase, started_at, transition_reason, parent_phase_id)
								VALUES
									(
										${tddTaskId},
										${null},
										${"spike"},
										${input.startedAt},
										${"opened by tdd_task_start"},
										${null}
									)
							`;
						}

						return tddTaskId;
					}),
				)
				.pipe(
					Effect.annotateLogs("service", "DataStore"),
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "tdd_tasks", reason: extractSqlReason(e) }),
					),
				);

		const endTddTask = (input: EndTddTaskInput): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("endTddTask").pipe(Effect.annotateLogs({ id: input.id, outcome: input.outcome }));
				yield* sql`
					UPDATE tdd_tasks
					SET ended_at = ${input.endedAt},
					    outcome = ${input.outcome},
					    summary_note_id = ${input.summaryNoteId ?? null}
					WHERE id = ${input.id}
				`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "tdd_tasks", reason: extractSqlReason(e) }),
				),
			);

		interface TddTaskStatusRow {
			ended_at: string | null;
			outcome: string | null;
		}

		const ensureTddTaskOpen = (
			tddTaskId: number,
		): Effect.Effect<void, DataStoreError | TddTaskNotFoundError | TddTaskAlreadyEndedError> =>
			Effect.gen(function* () {
				const rows = yield* sql<TddTaskStatusRow>`
					SELECT ended_at, outcome FROM tdd_tasks WHERE id = ${tddTaskId}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_tasks", reason: extractSqlReason(e) }),
					),
				);
				if (rows.length === 0) {
					return yield* Effect.fail(
						new TddTaskNotFoundError({ id: tddTaskId, reason: "no tdd_tasks row for that id" }),
					);
				}
				const row = rows[0];
				if (row.ended_at !== null) {
					return yield* Effect.fail(
						new TddTaskAlreadyEndedError({
							id: tddTaskId,
							endedAt: row.ended_at,
							outcome: (row.outcome ?? "abandoned") as "succeeded" | "blocked" | "abandoned",
						}),
					);
				}
			});

		const ensureTddTaskExists = (tddTaskId: number): Effect.Effect<void, DataStoreError | TddTaskNotFoundError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{ id: number }>`SELECT id FROM tdd_tasks WHERE id = ${tddTaskId}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "tdd_tasks", reason: extractSqlReason(e) }),
					),
				);
				if (rows.length === 0) {
					return yield* Effect.fail(
						new TddTaskNotFoundError({ id: tddTaskId, reason: "no tdd_tasks row for that id" }),
					);
				}
			});

		const createGoal = (
			input: CreateGoalInput,
		): Effect.Effect<GoalRow, DataStoreError | TddTaskNotFoundError | TddTaskAlreadyEndedError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("createGoal").pipe(
					Effect.annotateLogs({ tddTaskId: input.tddTaskId, goal: input.goal }),
				);
				yield* ensureTddTaskOpen(input.tddTaskId);
				const rows = yield* sql<{
					id: number;
					session_id: number;
					ordinal: number;
					goal: string;
					status: string;
					created_at: string;
				}>`
					INSERT INTO tdd_session_goals (session_id, ordinal, goal)
					SELECT ${input.tddTaskId},
					       COALESCE(MAX(ordinal), -1) + 1,
					       ${input.goal}
					FROM tdd_session_goals
					WHERE session_id = ${input.tddTaskId}
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
			DataStoreError | GoalNotFoundError | TddTaskAlreadyEndedError | IllegalStatusTransitionError
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
				yield* ensureTddTaskOpen(current.session_id).pipe(
					Effect.catchTag("TddTaskNotFoundError", (e) =>
						Effect.fail(
							new DataStoreError({
								operation: "read",
								table: "tdd_tasks",
								reason: `FK integrity violation: goal ${input.id} references missing tdd_tasks row ${e.id}`,
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

		const listGoalsByTddTask = (
			tddTaskId: number,
		): Effect.Effect<ReadonlyArray<GoalRow>, DataStoreError | TddTaskNotFoundError> =>
			Effect.gen(function* () {
				yield* ensureTddTaskExists(tddTaskId);
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
					WHERE session_id = ${tddTaskId}
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

		const ensureGoalOpenAndTaskOpen = (
			goalId: number,
		): Effect.Effect<
			{ goalTddTaskId: number; goalStatus: BehaviorStatus },
			DataStoreError | GoalNotFoundError | TddTaskAlreadyEndedError | IllegalStatusTransitionError
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
				yield* ensureTddTaskOpen(goal.session_id).pipe(
					Effect.catchTag("TddTaskNotFoundError", (e) =>
						Effect.fail(
							new DataStoreError({
								operation: "read",
								table: "tdd_tasks",
								reason: `FK integrity violation: goal ${goalId} references missing tdd_tasks row ${e.id}`,
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
				return { goalTddTaskId: goal.session_id, goalStatus: goal.status as BehaviorStatus };
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
			| TddTaskAlreadyEndedError
			| IllegalStatusTransitionError
		> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						yield* Effect.logDebug("createBehavior").pipe(
							Effect.annotateLogs({ goalId: input.goalId, behavior: input.behavior }),
						);
						yield* ensureGoalOpenAndTaskOpen(input.goalId);
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
						e instanceof TddTaskAlreadyEndedError ||
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
			DataStoreError | BehaviorNotFoundError | TddTaskAlreadyEndedError | IllegalStatusTransitionError
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
						yield* ensureTddTaskOpen(goalRows[0].session_id).pipe(
							Effect.catchTag("TddTaskNotFoundError", (e) =>
								Effect.fail(
									new DataStoreError({
										operation: "read",
										table: "tdd_tasks",
										reason: `FK integrity violation: goal ${current.goal_id} references missing tdd_tasks row ${e.id}`,
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
						e instanceof TddTaskAlreadyEndedError ||
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

		const listBehaviorsByTddTask = (
			tddTaskId: number,
		): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError | TddTaskNotFoundError> =>
			Effect.gen(function* () {
				yield* ensureTddTaskExists(tddTaskId);
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
					WHERE g.session_id = ${tddTaskId}
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
					Effect.annotateLogs({ tddTaskId: input.tddTaskId, phase: input.phase }),
				);

				// Find the currently-open phase (ended_at IS NULL) for this task,
				// if any, so we can close it as we open the new one.
				const open = yield* sql<{ id: number }>`
					SELECT id FROM tdd_phases
					WHERE tdd_task_id = ${input.tddTaskId} AND ended_at IS NULL
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
						(tdd_task_id, behavior_id, phase, started_at, transition_reason, parent_phase_id)
					VALUES
						(
							${input.tddTaskId},
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
			chatId: string;
			invocationMethod: string;
		}): Effect.Effect<void, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("associateLatestRunWithSession").pipe(
					Effect.annotateLogs({ chatId: input.chatId, invocationMethod: input.invocationMethod }),
				);
				// Single INSERT: CROSS JOIN ensures a no-op when either the latest run
				// or the session lookup returns no rows. INSERT OR IGNORE skips if the
				// run already has a trigger row.
				yield* sql`
					INSERT OR IGNORE INTO run_triggers (run_id, trigger, invocation_method, agent_session_id)
					SELECT r.id, 'agent', ${input.invocationMethod}, s.id
					FROM (SELECT id FROM test_runs ORDER BY id DESC LIMIT 1) r
					CROSS JOIN (SELECT id FROM sessions WHERE chat_id = ${input.chatId} LIMIT 1) s
				`;
			}).pipe(
				Effect.annotateLogs("service", "DataStore"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "run_triggers", reason: extractSqlReason(e) }),
				),
			);

		const backfillTestCaseTurns = (chatId: string): Effect.Effect<number, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("backfillTestCaseTurns").pipe(Effect.annotateLogs({ chatId }));
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
						WHERE s.chat_id = ${chatId}
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

		const registerAgent = (
			input: RegisterAgentInput,
		): Effect.Effect<Agent | IdempotencyHit, RegistrationConflictError | DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("registerAgent").pipe(
					Effect.annotateLogs({ sessionId: input.sessionId, agentType: input.agentType }),
				);

				// First check whether an idempotency hit applies — saves the
				// INSERT-and-catch-conflict round-trip.
				const existing = yield* sql<{ agent_id: string }>`
					SELECT agent_id FROM agents WHERE session_id = ${input.sessionId} AND idempotency_key = ${input.idempotencyKey}
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "agents", reason: extractSqlReason(e) }),
					),
				);
				if (existing.length > 0) {
					return new IdempotencyHit({ existingAgentId: existing[0].agent_id as never });
				}

				// Validate parent agent if supplied — must exist in the same session.
				if (input.parentAgentId !== null) {
					const parentRows = yield* sql<{ session_id: number }>`
						SELECT session_id FROM agents WHERE agent_id = ${input.parentAgentId}
					`.pipe(
						Effect.mapError(
							(e) => new DataStoreError({ operation: "read", table: "agents", reason: extractSqlReason(e) }),
						),
					);
					if (parentRows.length === 0) {
						return yield* Effect.fail(
							new RegistrationConflictError({
								reason: `parent agent ${input.parentAgentId} does not exist`,
							}),
						);
					}
					if (parentRows[0].session_id !== input.sessionId) {
						return yield* Effect.fail(
							new RegistrationConflictError({
								reason: `parent agent ${input.parentAgentId} belongs to session ${parentRows[0].session_id}, not ${input.sessionId}`,
							}),
						);
					}
				}

				const agentId = input.agentId ?? randomUUID();
				yield* sql`
					INSERT INTO agents (
						agent_id, session_id, parent_agent_id, conversation_id, agent_type,
						started_at, ended_at, start_git_branch, start_git_commit_sha, start_worktree_dir,
						idempotency_key
					) VALUES (
						${agentId}, ${input.sessionId}, ${input.parentAgentId}, ${input.conversationId},
						${input.agentType}, ${input.startedAt}, ${null}, ${input.startGitBranch ?? null},
						${input.startGitCommitSha ?? null}, ${input.startWorktreeDir ?? null}, ${input.idempotencyKey}
					)
				`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "agents", reason: extractSqlReason(e) }),
					),
				);

				return new Agent({
					agentId: agentId as never,
					sessionId: input.sessionId as never,
					parentAgentId: input.parentAgentId as never,
					conversationId: input.conversationId as never,
					agentType: input.agentType,
					startedAt: input.startedAt,
					endedAt: null,
					startGitBranch: input.startGitBranch ?? null,
					startGitCommitSha: input.startGitCommitSha ?? null,
					startWorktreeDir: input.startWorktreeDir ?? null,
					idempotencyKey: input.idempotencyKey,
				} as never);
			}).pipe(Effect.annotateLogs("service", "DataStore"));

		const endAgent = (agentId: string, endedAt: number): Effect.Effect<void, AgentNotFoundError | DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("endAgent").pipe(Effect.annotateLogs({ agentId }));
				yield* sql`UPDATE agents SET ended_at = ${endedAt} WHERE agent_id = ${agentId}`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "write", table: "agents", reason: extractSqlReason(e) }),
					),
				);
				const changes = yield* sql<{ n: number }>`SELECT changes() AS n`.pipe(
					Effect.mapError(
						(e) => new DataStoreError({ operation: "read", table: "agents", reason: extractSqlReason(e) }),
					),
				);
				if ((changes[0]?.n ?? 0) === 0) {
					return yield* Effect.fail(new AgentNotFoundError({ agentId: agentId as never }));
				}
			}).pipe(Effect.annotateLogs("service", "DataStore"));

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
			upsertSession,
			writeTurn,
			writeFailureSignature,
			endSession,
			writeHypothesis,
			validateHypothesis,
			writeTddTask,
			endTddTask,
			createGoal,
			getGoal,
			updateGoal,
			deleteGoal,
			listGoalsByTddTask,
			createBehavior,
			getBehavior,
			updateBehavior,
			deleteBehavior,
			listBehaviorsByGoal,
			listBehaviorsByTddTask,
			writeTddPhase,
			writeTddArtifact,
			writeCommit,
			writeRunChangedFiles,
			recordIdempotentResponse,
			pruneSessions,
			associateLatestRunWithSession,
			backfillTestCaseTurns,
			registerAgent,
			endAgent,
		};
	}),
);
