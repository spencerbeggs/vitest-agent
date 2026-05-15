import { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Layer, Option } from "effect";
import { DataStoreError, extractSqlReason } from "../errors/DataStoreError.js";
import type { AgentReport } from "../schemas/AgentReport.js";
import type { CoverageBaselines } from "../schemas/Baselines.js";
import type { CacheManifest } from "../schemas/CacheManifest.js";
import type { CoverageReport, FileCoverageReport } from "../schemas/Coverage.js";
import type { HistoryRecord } from "../schemas/History.js";
import type { BehaviorDetail, BehaviorRow, BehaviorStatus, GoalDetail, GoalStatus } from "../schemas/Tdd.js";
import type { TrendRecord } from "../schemas/Trends.js";
import type {
	AcceptanceMetrics,
	CitedArtifactRow,
	CommitChangesEntry,
	CurrentTddPhase,
	FailureSignatureDetail,
	FlakyTest,
	HypothesisDetail,
	ModuleListEntry,
	NoteRow,
	PersistentFailure,
	ProjectRunSummary,
	SessionDetail,
	SettingsListEntry,
	SettingsRow,
	SuiteListEntry,
	TagInventoryRow,
	TddArtifactRow,
	TddTaskDetail,
	TddTaskSummary,
	TestError,
	TestListEntry,
	TurnSearchOptions,
	TurnSummary,
} from "../services/DataReader.js";
import { DataReader } from "../services/DataReader.js";
import type { ArtifactKind, ChangeKind, Phase } from "../services/DataStore.js";

export const DataReaderLive: Layer.Layer<DataReader, never, SqlClient> = Layer.effect(
	DataReader,
	Effect.gen(function* () {
		const sql = yield* SqlClient;

		const getLatestRun = (project: string): Effect.Effect<Option.Option<AgentReport>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getLatestRun").pipe(Effect.annotateLogs({ project }));
				// Get the latest run for this project
				const runs = yield* sql<{
					id: number;
					timestamp: string;
					reason: string;
					duration: number;
					total: number;
					passed: number;
					failed: number;
					skipped: number;
					project: string;
				}>`SELECT id, timestamp, reason, duration, total, passed, failed, skipped, project
					FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return Option.none();
				const run = runs[0];

				// Get failed modules with their test cases
				const failedModules = yield* sql<{
					file_path: string;
					module_state: string;
					module_duration: number | null;
					module_id: number;
				}>`SELECT f.path as file_path, tm.state as module_state, tm.duration as module_duration, tm.id as module_id
					FROM test_modules tm
					JOIN files f ON f.id = tm.file_id
					WHERE tm.run_id = ${run.id} AND tm.state = 'failed'`;

				// Bulk-fetch test cases and errors for all failed modules (3 queries instead of O(M×N))
				const moduleIds = failedModules.map((m) => m.module_id);

				const allTestCases =
					moduleIds.length > 0
						? yield* sql<{
								module_id: number;
								test_case_id: number;
								name: string;
								full_name: string;
								state: string;
								duration: number | null;
								flaky: number | null;
								slow: number | null;
								classification: string | null;
							}>`SELECT tc.module_id, tc.id as test_case_id, tc.name, tc.full_name, tc.state, tc.duration, tc.flaky, tc.slow, tc.classification
							FROM test_cases tc WHERE tc.module_id IN ${sql.in(moduleIds)}`
						: [];

				const allErrors =
					moduleIds.length > 0
						? yield* sql<{
								test_case_id: number | null;
								module_id: number | null;
								scope: string;
								message: string;
								stack: string | null;
								diff: string | null;
							}>`SELECT te.test_case_id, te.module_id, te.scope, te.message, te.stack, te.diff
							FROM test_errors te
							WHERE te.run_id = ${run.id}
							  AND te.module_id IN ${sql.in(moduleIds)}`
						: [];

				// Group in TypeScript
				type TestCaseRow = (typeof allTestCases)[number];
				type ErrorRow = (typeof allErrors)[number];
				const testsByModule = new Map<number, TestCaseRow[]>();
				for (const tc of allTestCases) {
					const arr = testsByModule.get(tc.module_id);
					if (arr) arr.push(tc);
					else testsByModule.set(tc.module_id, [tc]);
				}
				const errorsByTestCase = new Map<number, ErrorRow[]>();
				const errorsByModule = new Map<number, ErrorRow[]>();
				for (const e of allErrors) {
					if (e.scope === "test" && e.test_case_id != null) {
						const arr = errorsByTestCase.get(e.test_case_id);
						if (arr) arr.push(e);
						else errorsByTestCase.set(e.test_case_id, [e]);
					} else if (e.scope === "module" && e.module_id != null) {
						const arr = errorsByModule.get(e.module_id);
						if (arr) arr.push(e);
						else errorsByModule.set(e.module_id, [e]);
					}
				}

				const failedModuleReports = failedModules.map((mod) => {
					const tests = testsByModule.get(mod.module_id) ?? [];
					const modErrors = errorsByModule.get(mod.module_id) ?? [];

					const testReports = tests.map((tc) => {
						const tcErrors = errorsByTestCase.get(tc.test_case_id) ?? [];
						return {
							name: tc.name,
							fullName: tc.full_name,
							state: tc.state as "passed" | "failed" | "skipped" | "pending",
							...(tc.duration != null ? { duration: tc.duration } : {}),
							...(tc.flaky === 1 ? { flaky: true } : {}),
							...(tc.slow === 1 ? { slow: true } : {}),
							...(tcErrors.length > 0
								? {
										errors: tcErrors.map((e) => ({
											message: e.message,
											...(e.stack != null ? { stack: e.stack } : {}),
											...(e.diff != null ? { diff: e.diff } : {}),
										})),
									}
								: {}),
							...(tc.classification != null
								? {
										classification: tc.classification as
											| "stable"
											| "new-failure"
											| "persistent"
											| "flaky"
											| "recovered",
									}
								: {}),
						};
					});

					return {
						file: mod.file_path,
						state: mod.module_state as "passed" | "failed" | "skipped" | "pending",
						...(mod.module_duration != null ? { duration: mod.module_duration } : {}),
						...(modErrors.length > 0
							? {
									errors: modErrors.map((e) => ({
										message: e.message,
										...(e.stack != null ? { stack: e.stack } : {}),
										...(e.diff != null ? { diff: e.diff } : {}),
									})),
								}
							: {}),
						tests: testReports,
					};
				});

				// Get unhandled errors
				const unhandledErrors = yield* sql<{
					message: string;
					stack: string | null;
					diff: string | null;
				}>`SELECT message, stack, diff FROM test_errors
					WHERE run_id = ${run.id} AND scope = 'unhandled'`;

				// Get failed file paths
				const failedFiles = failedModules.map((m) => m.file_path);

				const projectName = run.project;

				// Per-file coverage rows for this run, split into the two
				// tiers introduced by migration 0005. `lowCoverage`
				// surfaces threshold violations; `belowTarget` surfaces
				// aspirational-target gaps. Without this assembly, the
				// CLI's `coverage` subcommand had no per-file data to
				// render even though the rows were on disk.
				const fileCovRows = yield* sql<{
					file_path: string;
					statements: number;
					branches: number;
					functions: number;
					lines: number;
					uncovered_lines: string | null;
					tier: string;
				}>`SELECT f.path AS file_path, fc.statements, fc.branches, fc.functions, fc.lines,
					   fc.uncovered_lines, fc.tier
					FROM file_coverage fc
					JOIN files f ON f.id = fc.file_id
					WHERE fc.run_id = ${run.id}`;

				const lowCoverage = fileCovRows
					.filter((r) => r.tier === "below_threshold")
					.map((r) => ({
						file: r.file_path,
						summary: {
							statements: r.statements,
							branches: r.branches,
							functions: r.functions,
							lines: r.lines,
						},
						uncoveredLines: r.uncovered_lines ?? "",
					}));
				const belowTarget = fileCovRows
					.filter((r) => r.tier === "below_target")
					.map((r) => ({
						file: r.file_path,
						summary: {
							statements: r.statements,
							branches: r.branches,
							functions: r.functions,
							lines: r.lines,
						},
						uncoveredLines: r.uncovered_lines ?? "",
					}));

				const trendRows = yield* sql<{
					statements: number;
					branches: number;
					functions: number;
					lines: number;
				}>`SELECT statements, branches, functions, lines FROM coverage_trends WHERE run_id = ${run.id} LIMIT 1`;
				const totals = trendRows[0]
					? {
							statements: trendRows[0].statements,
							branches: trendRows[0].branches,
							functions: trendRows[0].functions,
							lines: trendRows[0].lines,
						}
					: { statements: 0, branches: 0, functions: 0, lines: 0 };

				const baselineRows = yield* sql<{
					metric: string;
					value: number;
				}>`SELECT metric, value FROM coverage_baselines
					WHERE project = '__global__' AND pattern = ''`;
				const thresholds: { lines?: number; functions?: number; branches?: number; statements?: number } = {};
				for (const b of baselineRows) {
					if (b.metric === "lines") thresholds.lines = b.value;
					else if (b.metric === "functions") thresholds.functions = b.value;
					else if (b.metric === "branches") thresholds.branches = b.value;
					else if (b.metric === "statements") thresholds.statements = b.value;
				}

				const coverage =
					fileCovRows.length > 0 || trendRows.length > 0
						? {
								totals,
								thresholds: { global: thresholds, patterns: [] as Array<[string, typeof thresholds]> },
								scoped: false,
								lowCoverage,
								lowCoverageFiles: lowCoverage.map((f) => f.file),
								...(belowTarget.length > 0 ? { belowTarget, belowTargetFiles: belowTarget.map((f) => f.file) } : {}),
							}
						: undefined;

				const report: AgentReport = {
					timestamp: run.timestamp,
					project: projectName,
					reason: run.reason as "passed" | "failed" | "interrupted",
					summary: {
						total: run.total,
						passed: run.passed,
						failed: run.failed,
						skipped: run.skipped,
						duration: run.duration,
					},
					failed: failedModuleReports,
					unhandledErrors: unhandledErrors.map((e) => ({
						message: e.message,
						...(e.stack != null ? { stack: e.stack } : {}),
						...(e.diff != null ? { diff: e.diff } : {}),
					})),
					failedFiles,
					...(coverage ? { coverage } : {}),
				};

				return Option.some(report);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_runs", reason: extractSqlReason(e) }),
				),
			);

		const getRunsByProject = (): Effect.Effect<ReadonlyArray<ProjectRunSummary>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getRunsByProject");
				const rows = yield* sql<{
					project: string;
					last_run: string | null;
					last_result: string | null;
					total: number;
					passed: number;
					failed: number;
					skipped: number;
				}>`SELECT
						t1.project,
						t1.timestamp as last_run,
						t1.reason as last_result,
						t1.total,
						t1.passed,
						t1.failed,
						t1.skipped
					FROM test_runs t1
					INNER JOIN (
						SELECT project, MAX(timestamp) as max_ts
						FROM test_runs
						GROUP BY project
					) t2 ON t1.project = t2.project
						AND t1.timestamp = t2.max_ts`;

				return rows.map((r) => ({
					project: r.project,
					lastRun: r.last_run,
					lastResult: r.last_result as "passed" | "failed" | "interrupted" | null,
					total: r.total,
					passed: r.passed,
					failed: r.failed,
					skipped: r.skipped,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_runs", reason: extractSqlReason(e) }),
				),
			);

		const getHistory = (project: string): Effect.Effect<HistoryRecord, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getHistory").pipe(Effect.annotateLogs({ project }));
				const rows = yield* sql<{
					full_name: string;
					timestamp: string;
					state: string;
				}>`SELECT full_name, timestamp, state
					FROM test_history
					WHERE project = ${project}
					ORDER BY full_name, timestamp DESC`;

				// Group by full_name
				const testsMap = new Map<string, Array<{ timestamp: string; state: "passed" | "failed" }>>();
				for (const row of rows) {
					// Only include passed/failed states per HistoryRecord schema
					if (row.state !== "passed" && row.state !== "failed") continue;
					const existing = testsMap.get(row.full_name);
					if (existing) {
						existing.push({ timestamp: row.timestamp, state: row.state });
					} else {
						testsMap.set(row.full_name, [{ timestamp: row.timestamp, state: row.state }]);
					}
				}

				const tests = Array.from(testsMap.entries()).map(([fullName, runs]) => ({
					fullName,
					runs,
				}));

				// Use the latest timestamp across all tests, not just the first test
				const latestTimestamp = tests.reduce((latest, t) => {
					const ts = t.runs[0]?.timestamp ?? "";
					return ts > latest ? ts : latest;
				}, "");

				const record: HistoryRecord = {
					project,
					updatedAt: latestTimestamp || new Date().toISOString(),
					tests,
				};

				return record;
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_history", reason: extractSqlReason(e) }),
				),
			);

		const getBaselines = (project: string): Effect.Effect<Option.Option<CoverageBaselines>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getBaselines").pipe(Effect.annotateLogs({ project }));
				// Baselines are stored with project='__global__' currently per DataStoreLive
				const rows = yield* sql<{
					metric: string;
					value: number;
					pattern: string;
					updated_at: string;
				}>`SELECT metric, value, pattern, updated_at
					FROM coverage_baselines
					WHERE project = ${project}
					ORDER BY pattern, metric`;

				if (rows.length === 0) return Option.none();

				const global: Record<string, number> = {};
				const patternsMap = new Map<string, Record<string, number>>();
				let updatedAt = rows[0].updated_at;

				for (const row of rows) {
					if (row.updated_at > updatedAt) updatedAt = row.updated_at;
					if (row.pattern === "") {
						global[row.metric] = row.value;
					} else {
						const existing = patternsMap.get(row.pattern);
						if (existing) {
							existing[row.metric] = row.value;
						} else {
							patternsMap.set(row.pattern, { [row.metric]: row.value });
						}
					}
				}

				const patterns: Array<[string, Record<string, number>]> = Array.from(patternsMap.entries());

				const baselines: CoverageBaselines = {
					updatedAt,
					global,
					patterns,
				};

				return Option.some(baselines);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "coverage_baselines", reason: extractSqlReason(e) }),
				),
			);

		const getTrends = (project: string, limit?: number): Effect.Effect<Option.Option<TrendRecord>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getTrends").pipe(Effect.annotateLogs({ project, limit: limit ?? 50 }));
				const effectiveLimit = limit ?? 50;
				const rows = yield* sql<{
					timestamp: string;
					lines: number;
					functions: number;
					branches: number;
					statements: number;
					direction: string;
					targets_hash: string | null;
				}>`SELECT timestamp, lines, functions, branches, statements, direction, targets_hash
					FROM coverage_trends
					WHERE project = ${project}
					ORDER BY timestamp DESC
					LIMIT ${effectiveLimit}`;

				if (rows.length === 0) return Option.none();

				// Compute deltas (rows are newest-first, reverse for chronological order)
				const chronological = [...rows].reverse();
				const entries = chronological.map((row, i) => {
					const prev = i > 0 ? chronological[i - 1] : null;
					return {
						timestamp: row.timestamp,
						coverage: {
							lines: row.lines,
							functions: row.functions,
							branches: row.branches,
							statements: row.statements,
						},
						delta: prev
							? {
									lines: row.lines - prev.lines,
									functions: row.functions - prev.functions,
									branches: row.branches - prev.branches,
									statements: row.statements - prev.statements,
								}
							: { lines: 0, functions: 0, branches: 0, statements: 0 },
						direction: row.direction as "improving" | "regressing" | "stable",
						...(row.targets_hash != null ? { targetsHash: row.targets_hash } : {}),
					};
				});

				const record: TrendRecord = { entries };
				return Option.some(record);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "coverage_trends", reason: extractSqlReason(e) }),
				),
			);

		const getFlaky = (project: string): Effect.Effect<ReadonlyArray<FlakyTest>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getFlaky").pipe(Effect.annotateLogs({ project }));
				const rows = yield* sql<{
					full_name: string;
					project: string;
					pass_count: number;
					fail_count: number;
					last_state: string;
					last_timestamp: string;
				}>`SELECT
						th1.full_name,
						th1.project,
						SUM(CASE WHEN th1.state = 'passed' THEN 1 ELSE 0 END) as pass_count,
						SUM(CASE WHEN th1.state = 'failed' THEN 1 ELSE 0 END) as fail_count,
						(SELECT state FROM test_history th2
						 WHERE th2.full_name = th1.full_name
						   AND th2.project = th1.project
						 ORDER BY timestamp DESC LIMIT 1) as last_state,
						MAX(th1.timestamp) as last_timestamp
					FROM test_history th1
					WHERE th1.project = ${project}
					GROUP BY th1.full_name, th1.project
					HAVING pass_count > 0 AND fail_count > 0`;

				return rows.map((r) => ({
					fullName: r.full_name,
					project: r.project,
					passCount: r.pass_count,
					failCount: r.fail_count,
					lastState: r.last_state as "passed" | "failed",
					lastTimestamp: r.last_timestamp,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_history", reason: extractSqlReason(e) }),
				),
			);

		const getPersistentFailures = (project: string): Effect.Effect<ReadonlyArray<PersistentFailure>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getPersistentFailures").pipe(Effect.annotateLogs({ project }));
				// Single query with window functions to find tests with 2+ consecutive
				// trailing failures (replaces previous N+1 pattern)
				const rows = yield* sql<{
					full_name: string;
					project: string;
					consecutive_failures: number;
					first_failed_at: string;
					last_failed_at: string;
					last_error_message: string | null;
				}>`WITH ranked AS (
					SELECT full_name, project, state, timestamp, error_message,
						ROW_NUMBER() OVER (
							PARTITION BY project, full_name
							ORDER BY timestamp DESC
						) as rn
					FROM test_history
					WHERE project = ${project}
				),
				streak AS (
					SELECT full_name, project, state, timestamp, error_message, rn,
						MIN(CASE WHEN state != 'failed' THEN rn END) OVER (
							PARTITION BY project, full_name
						) as first_pass_rn
					FROM ranked
				)
				SELECT
					full_name, project,
					COUNT(*) as consecutive_failures,
					MIN(timestamp) as first_failed_at,
					MAX(timestamp) as last_failed_at,
					(SELECT error_message FROM streak s2
					 WHERE s2.full_name = streak.full_name
					   AND s2.project = streak.project
					   AND s2.rn = 1) as last_error_message
				FROM streak
				WHERE state = 'failed'
					AND (first_pass_rn IS NULL OR rn < first_pass_rn)
				GROUP BY full_name, project
				HAVING consecutive_failures >= 2`;

				return rows.map((row) => ({
					fullName: row.full_name,
					project: row.project,
					consecutiveFailures: row.consecutive_failures,
					firstFailedAt: row.first_failed_at,
					lastFailedAt: row.last_failed_at,
					lastErrorMessage: row.last_error_message,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_history", reason: extractSqlReason(e) }),
				),
			);

		const getFileCoverage = (runId: number): Effect.Effect<ReadonlyArray<FileCoverageReport>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getFileCoverage").pipe(Effect.annotateLogs({ runId }));
				const rows = yield* sql<{
					file_path: string;
					statements: number;
					branches: number;
					functions: number;
					lines: number;
					uncovered_lines: string | null;
				}>`SELECT f.path as file_path, fc.statements, fc.branches, fc.functions, fc.lines, fc.uncovered_lines
					FROM file_coverage fc
					JOIN files f ON f.id = fc.file_id
					WHERE fc.run_id = ${runId}`;

				return rows.map((r) => ({
					file: r.file_path,
					summary: {
						statements: r.statements,
						branches: r.branches,
						functions: r.functions,
						lines: r.lines,
					},
					uncoveredLines: r.uncovered_lines ?? "",
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "file_coverage", reason: extractSqlReason(e) }),
				),
			);

		const getCoverage = (project: string): Effect.Effect<Option.Option<CoverageReport>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getCoverage").pipe(Effect.annotateLogs({ project }));

				// 1. Find latest run_id for the project
				const runs = yield* sql<{
					id: number;
					timestamp: string;
				}>`SELECT id, timestamp FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return Option.none();
				const runId = runs[0].id;

				// 2. Query file_coverage joined with files for that run_id.
				// The reporter only writes per-file rows for files below threshold
				// (see reporter.ts onTestRunEnd), so this list is the lowCoverage
				// set, not the full file inventory.
				const fileCoverageRows = yield* sql<{
					file_path: string;
					statements: number;
					branches: number;
					functions: number;
					lines: number;
					uncovered_lines: string | null;
				}>`SELECT f.path as file_path, fc.statements, fc.branches, fc.functions, fc.lines, fc.uncovered_lines
					FROM file_coverage fc JOIN files f ON f.id = fc.file_id
					WHERE fc.run_id = ${runId}`;

				// 3. Get totals from coverage_trends (most recent for this project).
				// When file_coverage is empty (all files above threshold), trends are
				// the only source of coverage info — fall back to a totals-only report
				// rather than returning "no coverage data".
				const trendRows = yield* sql<{
					statements: number;
					branches: number;
					functions: number;
					lines: number;
				}>`SELECT statements, branches, functions, lines
					FROM coverage_trends
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (fileCoverageRows.length === 0 && trendRows.length === 0) {
					return Option.none();
				}

				// Compute totals: use trends if available, otherwise approximate
				// from file coverage averages (imprecise without per-file
				// statement counts, but acceptable when trend data is unavailable)
				let totals: { statements: number; branches: number; functions: number; lines: number };
				if (trendRows.length > 0) {
					totals = {
						statements: trendRows[0].statements,
						branches: trendRows[0].branches,
						functions: trendRows[0].functions,
						lines: trendRows[0].lines,
					};
				} else {
					const count = fileCoverageRows.length;
					totals = {
						statements: fileCoverageRows.reduce((sum, r) => sum + r.statements, 0) / count,
						branches: fileCoverageRows.reduce((sum, r) => sum + r.branches, 0) / count,
						functions: fileCoverageRows.reduce((sum, r) => sum + r.functions, 0) / count,
						lines: fileCoverageRows.reduce((sum, r) => sum + r.lines, 0) / count,
					};
				}

				// 4. Get baselines via existing getBaselines(). Baselines are stored
				// with project='__global__' per DataStoreLive.writeBaselines()
				const baselinesOpt = yield* getBaselines("__global__");
				const baselines = Option.getOrElse(baselinesOpt, () => ({
					updatedAt: "",
					global: {} as Record<string, number>,
					patterns: [] as Array<[string, Record<string, number>]>,
				}));

				// 5. Build lowCoverage from file_coverage rows. The reporter only
				// writes files below threshold to file_coverage, so all rows here
				// are already lowCoverage entries.
				const lowCoverage: FileCoverageReport[] = fileCoverageRows.map((r) => ({
					file: r.file_path,
					summary: {
						statements: r.statements,
						branches: r.branches,
						functions: r.functions,
						lines: r.lines,
					},
					uncoveredLines: r.uncovered_lines ?? "",
				}));

				// TODO: populate targets, belowTarget, belowTargetFiles when
				// target queries are wired up (currently omitted — previous
				// implementation was broken, acceptable as stepping stone)
				const report: CoverageReport = {
					totals,
					thresholds: {
						global: baselines.global,
						patterns: baselines.patterns,
					},
					scoped: false,
					lowCoverage,
					lowCoverageFiles: lowCoverage.map((f) => f.file),
				};

				return Option.some(report);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "file_coverage", reason: extractSqlReason(e) }),
				),
			);

		const getTestsForFile = (filePath: string): Effect.Effect<ReadonlyArray<string>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getTestsForFile").pipe(Effect.annotateLogs({ filePath }));
				const rows = yield* sql<{
					path: string;
				}>`SELECT DISTINCT f.path
					FROM source_test_map stm
					JOIN files sf ON sf.id = stm.source_file_id
					JOIN test_modules tm ON tm.id = stm.test_module_id
					JOIN files f ON f.id = tm.file_id
					WHERE sf.path = ${filePath}
					ORDER BY f.path`;

				return rows.map((r) => r.path);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "source_test_map", reason: extractSqlReason(e) }),
				),
			);

		const getErrors = (project: string, errorName?: string): Effect.Effect<ReadonlyArray<TestError>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getErrors").pipe(Effect.annotateLogs({ project, errorName: errorName ?? null }));
				// Get the latest run for this project
				const runs = yield* sql<{
					id: number;
				}>`SELECT id FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return [];

				const runId = runs[0].id;

				// LEFT JOIN to stack_frames is filtered to ordinal=0 so the
				// row collapses to a single "top frame" per error. Errors
				// with no recorded frames produce top_stack_frame_id=null.
				const baseQuery = errorName
					? sql<{
							id: number;
							top_stack_frame_id: number | null;
							name: string | null;
							message: string;
							diff: string | null;
							actual: string | null;
							expected: string | null;
							stack: string | null;
							scope: string;
							test_full_name: string | null;
							module_file: string | null;
						}>`SELECT te.id, sf.id AS top_stack_frame_id,
							te.name, te.message, te.diff, te.actual, te.expected, te.stack, te.scope,
							tc.full_name as test_full_name,
							f.path as module_file
						FROM test_errors te
						LEFT JOIN test_cases tc ON tc.id = te.test_case_id
						LEFT JOIN test_modules tm ON tm.id = te.module_id
						LEFT JOIN files f ON f.id = tm.file_id
						LEFT JOIN stack_frames sf ON sf.error_id = te.id AND sf.ordinal = 0
						WHERE te.run_id = ${runId} AND te.name = ${errorName}`
					: sql<{
							id: number;
							top_stack_frame_id: number | null;
							name: string | null;
							message: string;
							diff: string | null;
							actual: string | null;
							expected: string | null;
							stack: string | null;
							scope: string;
							test_full_name: string | null;
							module_file: string | null;
						}>`SELECT te.id, sf.id AS top_stack_frame_id,
							te.name, te.message, te.diff, te.actual, te.expected, te.stack, te.scope,
							tc.full_name as test_full_name,
							f.path as module_file
						FROM test_errors te
						LEFT JOIN test_cases tc ON tc.id = te.test_case_id
						LEFT JOIN test_modules tm ON tm.id = te.module_id
						LEFT JOIN files f ON f.id = tm.file_id
						LEFT JOIN stack_frames sf ON sf.error_id = te.id AND sf.ordinal = 0
						WHERE te.run_id = ${runId}`;

				const rows = yield* baseQuery;

				return rows.map((r) => ({
					id: r.id,
					topStackFrameId: r.top_stack_frame_id,
					name: r.name,
					message: r.message,
					diff: r.diff,
					actual: r.actual,
					expected: r.expected,
					stack: r.stack,
					scope: r.scope as "test" | "suite" | "module" | "unhandled",
					testFullName: r.test_full_name,
					moduleFile: r.module_file,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_errors", reason: extractSqlReason(e) }),
				),
			);

		const getNotes = (
			scope?: string,
			project?: string,
			testFullName?: string,
		): Effect.Effect<ReadonlyArray<NoteRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getNotes").pipe(
					Effect.annotateLogs({ scope: scope ?? null, project: project ?? null }),
				);
				// Build dynamic query based on provided filters
				if (scope && project && testFullName) {
					const rows = yield* sql<NoteDbRow>`SELECT * FROM notes
						WHERE scope = ${scope} AND project = ${project} AND test_full_name = ${testFullName}
						ORDER BY created_at DESC`;
					return rows.map(mapNoteRow);
				}
				if (scope && project) {
					const rows = yield* sql<NoteDbRow>`SELECT * FROM notes
						WHERE scope = ${scope} AND project = ${project}
						ORDER BY created_at DESC`;
					return rows.map(mapNoteRow);
				}
				if (scope) {
					const rows = yield* sql<NoteDbRow>`SELECT * FROM notes
						WHERE scope = ${scope}
						ORDER BY created_at DESC`;
					return rows.map(mapNoteRow);
				}
				if (project) {
					const rows = yield* sql<NoteDbRow>`SELECT * FROM notes
						WHERE project = ${project}
						ORDER BY created_at DESC`;
					return rows.map(mapNoteRow);
				}
				const rows = yield* sql<NoteDbRow>`SELECT * FROM notes ORDER BY created_at DESC`;
				return rows.map(mapNoteRow);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "notes", reason: extractSqlReason(e) })),
			);

		const getNoteById = (id: number): Effect.Effect<Option.Option<NoteRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getNoteById").pipe(Effect.annotateLogs({ id }));
				const rows = yield* sql<NoteDbRow>`SELECT * FROM notes WHERE id = ${id}`;
				if (rows.length === 0) return Option.none();
				return Option.some(mapNoteRow(rows[0]));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "notes", reason: extractSqlReason(e) })),
			);

		const searchNotes = (query: string): Effect.Effect<ReadonlyArray<NoteRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("searchNotes").pipe(Effect.annotateLogs({ query }));
				const rows = yield* sql<NoteDbRow>`SELECT n.*
					FROM notes n
					JOIN notes_fts ON n.id = notes_fts.rowid
					WHERE notes_fts MATCH ${query}
					ORDER BY rank`;
				return rows.map(mapNoteRow);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "notes", reason: extractSqlReason(e) })),
			);

		const getManifest = (): Effect.Effect<Option.Option<CacheManifest>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getManifest");
				const rows = yield* sql<{
					project: string;
					last_run: string | null;
					last_result: string | null;
				}>`SELECT
						t1.project,
						t1.timestamp as last_run,
						t1.reason as last_result
					FROM test_runs t1
					INNER JOIN (
						SELECT project, MAX(timestamp) as max_ts
						FROM test_runs
						GROUP BY project
					) t2 ON t1.project = t2.project
						AND t1.timestamp = t2.max_ts`;

				if (rows.length === 0) return Option.none();

				// Resolve the database file path from SQLite's own metadata.
				// PRAGMA database_list returns one row per attached database;
				// the "main" database is the one we opened.
				const dbList = yield* sql<{ name: string; file: string }>`PRAGMA database_list`.pipe(
					Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<{ name: string; file: string }>)),
				);
				const mainDb = dbList.find((d) => d.name === "main");
				const dbPath = mainDb?.file ?? "";

				const projects = rows.map((r) => ({
					project: r.project,
					reportFile: dbPath,
					historyFile: dbPath,
					lastRun: r.last_run,
					lastResult: r.last_result as "passed" | "failed" | "interrupted" | null,
				}));

				const latestRun = rows.reduce<string | null>((latest, r) => {
					if (!r.last_run) return latest;
					if (!latest) return r.last_run;
					return r.last_run > latest ? r.last_run : latest;
				}, null);

				const manifest: CacheManifest = {
					updatedAt: latestRun ?? new Date().toISOString(),
					cacheDir: dbPath,
					projects,
				};

				return Option.some(manifest);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_runs", reason: extractSqlReason(e) }),
				),
			);

		const getSettings = (hash: string): Effect.Effect<Option.Option<SettingsRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getSettings").pipe(Effect.annotateLogs({ hash }));
				const rows = yield* sql<{
					hash: string;
					vitest_version: string;
					pool: string | null;
					environment: string | null;
					coverage_provider: string | null;
					created_at: string;
				}>`SELECT hash, vitest_version, pool, environment, coverage_provider, created_at
					FROM settings WHERE hash = ${hash}`;

				if (rows.length === 0) return Option.none();
				const row = rows[0];

				// Get env vars
				const envRows = yield* sql<{
					key: string;
					value: string;
				}>`SELECT key, value FROM settings_env_vars WHERE settings_hash = ${hash}`;

				const envVars: Record<string, string> = {};
				for (const ev of envRows) {
					envVars[ev.key] = ev.value;
				}

				const settings: SettingsRow = {
					hash: row.hash,
					reporters: null,
					coverageEnabled: row.coverage_provider != null,
					coverageProvider: row.coverage_provider,
					coverageThresholds: null,
					coverageTargets: null,
					pool: row.pool,
					shard: null,
					project: null,
					environment: row.environment,
					envVars,
					capturedAt: row.created_at,
				};

				return Option.some(settings);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "settings", reason: extractSqlReason(e) }),
				),
			);

		const getLatestSettings = (): Effect.Effect<Option.Option<SettingsRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getLatestSettings");
				const rows = yield* sql<{
					hash: string;
					pool: string | null;
					environment: string | null;
					coverage_provider: string | null;
					created_at: string;
				}>`SELECT hash, pool, environment, coverage_provider, created_at
					FROM settings ORDER BY rowid DESC LIMIT 1`;

				if (rows.length === 0) return Option.none();
				const row = rows[0];

				const envRows = yield* sql<{
					key: string;
					value: string;
				}>`SELECT key, value FROM settings_env_vars WHERE settings_hash = ${row.hash}`;

				const envVars: Record<string, string> = {};
				for (const ev of envRows) {
					envVars[ev.key] = ev.value;
				}

				const settings: SettingsRow = {
					hash: row.hash,
					reporters: null,
					coverageEnabled: row.coverage_provider != null,
					coverageProvider: row.coverage_provider,
					coverageThresholds: null,
					coverageTargets: null,
					pool: row.pool,
					shard: null,
					project: null,
					environment: row.environment,
					envVars,
					capturedAt: row.created_at,
				};

				return Option.some(settings);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "settings", reason: extractSqlReason(e) }),
				),
			);

		const getTestByFullName = (
			project: string,
			fullName: string,
		): Effect.Effect<Option.Option<TestListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getTestByFullName").pipe(Effect.annotateLogs({ project, fullName }));

				const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return Option.none();
				const runId = runs[0].id;

				const rows = yield* sql<{
					id: number;
					full_name: string;
					state: string;
					duration: number | null;
					relative_module_id: string;
					classification: string | null;
				}>`SELECT tc.id, tc.full_name, tc.state, tc.duration, f.path as relative_module_id, tc.classification
					FROM test_cases tc
					JOIN test_modules tm ON tm.id = tc.module_id
					JOIN files f ON f.id = tm.file_id
					WHERE tm.run_id = ${runId} AND tc.full_name = ${fullName}
					LIMIT 1`;

				if (rows.length === 0) return Option.none();
				const r = rows[0];
				return Option.some({
					id: r.id,
					fullName: r.full_name,
					state: r.state,
					duration: r.duration,
					module: r.relative_module_id,
					classification: r.classification,
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_cases", reason: extractSqlReason(e) }),
				),
			);

		const listTests = (
			project: string,
			options?: { state?: string; module?: string; limit?: number },
		): Effect.Effect<ReadonlyArray<TestListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listTests").pipe(Effect.annotateLogs({ project }));

				// Find latest run_id
				const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return [];
				const runId = runs[0].id;

				const effectiveLimit = Math.min(options?.limit ?? 100, 500);
				const state = options?.state;
				const mod = options?.module;

				// Use separate SQL branches for filter combinations
				if (state && mod) {
					const rows = yield* sql<{
						id: number;
						full_name: string;
						state: string;
						duration: number | null;
						file_path: string;
						classification: string | null;
					}>`SELECT tc.id, tc.full_name as "full_name", tc.state, tc.duration, f.path as file_path, tc.classification
						FROM test_cases tc
						JOIN test_modules tm ON tm.id = tc.module_id
						JOIN files f ON f.id = tm.file_id
						WHERE tm.run_id = ${runId} AND tc.state = ${state} AND f.path = ${mod}
						ORDER BY tc.full_name
						LIMIT ${effectiveLimit}`;
					return rows.map(mapTestListRow);
				}
				if (state) {
					const rows = yield* sql<{
						id: number;
						full_name: string;
						state: string;
						duration: number | null;
						file_path: string;
						classification: string | null;
					}>`SELECT tc.id, tc.full_name as "full_name", tc.state, tc.duration, f.path as file_path, tc.classification
						FROM test_cases tc
						JOIN test_modules tm ON tm.id = tc.module_id
						JOIN files f ON f.id = tm.file_id
						WHERE tm.run_id = ${runId} AND tc.state = ${state}
						ORDER BY tc.full_name
						LIMIT ${effectiveLimit}`;
					return rows.map(mapTestListRow);
				}
				if (mod) {
					const rows = yield* sql<{
						id: number;
						full_name: string;
						state: string;
						duration: number | null;
						file_path: string;
						classification: string | null;
					}>`SELECT tc.id, tc.full_name as "full_name", tc.state, tc.duration, f.path as file_path, tc.classification
						FROM test_cases tc
						JOIN test_modules tm ON tm.id = tc.module_id
						JOIN files f ON f.id = tm.file_id
						WHERE tm.run_id = ${runId} AND f.path = ${mod}
						ORDER BY tc.full_name
						LIMIT ${effectiveLimit}`;
					return rows.map(mapTestListRow);
				}

				const rows = yield* sql<{
					id: number;
					full_name: string;
					state: string;
					duration: number | null;
					file_path: string;
					classification: string | null;
				}>`SELECT tc.id, tc.full_name as "full_name", tc.state, tc.duration, f.path as file_path, tc.classification
					FROM test_cases tc
					JOIN test_modules tm ON tm.id = tc.module_id
					JOIN files f ON f.id = tm.file_id
					WHERE tm.run_id = ${runId}
					ORDER BY tc.full_name
					LIMIT ${effectiveLimit}`;
				return rows.map(mapTestListRow);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_cases", reason: extractSqlReason(e) }),
				),
			);

		const listModules = (project: string): Effect.Effect<ReadonlyArray<ModuleListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listModules").pipe(Effect.annotateLogs({ project }));

				const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return [];
				const runId = runs[0].id;

				const rows = yield* sql<{
					id: number;
					file_path: string;
					state: string;
					test_count: number;
					duration: number | null;
				}>`SELECT tm.id, f.path as file_path, tm.state,
						(SELECT COUNT(*) FROM test_cases tc WHERE tc.module_id = tm.id) as test_count,
						tm.duration
					FROM test_modules tm
					JOIN files f ON f.id = tm.file_id
					WHERE tm.run_id = ${runId}
					ORDER BY f.path`;

				return rows.map((r) => ({
					id: r.id,
					file: r.file_path,
					state: r.state,
					testCount: r.test_count,
					duration: r.duration,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_modules", reason: extractSqlReason(e) }),
				),
			);

		const listSuites = (
			project: string,
			options?: { module?: string },
		): Effect.Effect<ReadonlyArray<SuiteListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listSuites").pipe(Effect.annotateLogs({ project }));

				const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
					WHERE project = ${project}
					ORDER BY timestamp DESC LIMIT 1`;

				if (runs.length === 0) return [];
				const runId = runs[0].id;

				const mod = options?.module;

				if (mod) {
					const rows = yield* sql<{
						id: number;
						name: string;
						file_path: string;
						state: string;
						test_count: number;
					}>`SELECT ts.id, ts.name, f.path as file_path, ts.state,
							(SELECT COUNT(*) FROM test_cases tc WHERE tc.suite_id = ts.id) as test_count
						FROM test_suites ts
						JOIN test_modules tm ON tm.id = ts.module_id
						JOIN files f ON f.id = tm.file_id
						WHERE tm.run_id = ${runId} AND f.path = ${mod}
						ORDER BY ts.name`;
					return rows.map((r) => ({
						id: r.id,
						name: r.name,
						module: r.file_path,
						state: r.state,
						testCount: r.test_count,
					}));
				}

				const rows = yield* sql<{
					id: number;
					name: string;
					file_path: string;
					state: string;
					test_count: number;
				}>`SELECT ts.id, ts.name, f.path as file_path, ts.state,
						(SELECT COUNT(*) FROM test_cases tc WHERE tc.suite_id = ts.id) as test_count
					FROM test_suites ts
					JOIN test_modules tm ON tm.id = ts.module_id
					JOIN files f ON f.id = tm.file_id
					WHERE tm.run_id = ${runId}
					ORDER BY ts.name`;
				return rows.map((r) => ({
					id: r.id,
					name: r.name,
					module: r.file_path,
					state: r.state,
					testCount: r.test_count,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "test_suites", reason: extractSqlReason(e) }),
				),
			);

		const listSettings = (): Effect.Effect<ReadonlyArray<SettingsListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listSettings");
				const rows = yield* sql<{
					hash: string;
					created_at: string;
				}>`SELECT hash, created_at FROM settings ORDER BY rowid DESC`;

				return rows.map((r) => ({
					hash: r.hash,
					capturedAt: r.created_at,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "settings", reason: extractSqlReason(e) }),
				),
			);

		interface SessionRow {
			id: number;
			chat_id: string;
			project: string;
			cwd: string;
			agent_kind: string;
			agent_type: string | null;
			parent_session_id: number | null;
			triage_was_non_empty: number;
			started_at: string;
			ended_at: string | null;
			end_reason: string | null;
		}

		const sessionRowToDetail = (r: SessionRow): SessionDetail => ({
			id: r.id,
			chatId: r.chat_id,
			project: r.project,
			cwd: r.cwd,
			agentKind: r.agent_kind as "main" | "subagent",
			agentType: r.agent_type,
			parentSessionId: r.parent_session_id,
			triageWasNonEmpty: r.triage_was_non_empty === 1,
			startedAt: r.started_at,
			endedAt: r.ended_at,
			endReason: r.end_reason,
		});

		const getSessionById = (id: number): Effect.Effect<Option.Option<SessionDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getSessionById").pipe(Effect.annotateLogs({ id }));
				const rows =
					yield* sql<SessionRow>`SELECT id, chat_id, project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at, ended_at, end_reason FROM sessions WHERE id = ${id} LIMIT 1`;
				if (rows.length === 0) return Option.none<SessionDetail>();
				return Option.some<SessionDetail>(sessionRowToDetail(rows[0]));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const getSessionByChatId = (chatId: string): Effect.Effect<Option.Option<SessionDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getSessionByChatId").pipe(Effect.annotateLogs({ chatId }));
				const rows =
					yield* sql<SessionRow>`SELECT id, chat_id, project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at, ended_at, end_reason FROM sessions WHERE chat_id = ${chatId} LIMIT 1`;
				if (rows.length === 0) return Option.none<SessionDetail>();
				return Option.some<SessionDetail>(sessionRowToDetail(rows[0]));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const findSessionsByChatPrefix = (prefix: string): Effect.Effect<ReadonlyArray<SessionDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("findSessionsByChatPrefix").pipe(Effect.annotateLogs({ prefix }));
				const pattern = `${prefix}%`;
				const rows =
					yield* sql<SessionRow>`SELECT id, chat_id, project, cwd, agent_kind, agent_type, parent_session_id, triage_was_non_empty, started_at, ended_at, end_reason FROM sessions WHERE chat_id LIKE ${pattern} ESCAPE '\\' ORDER BY started_at DESC`;
				return rows.map(sessionRowToDetail);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const searchTurns = (options: TurnSearchOptions): Effect.Effect<ReadonlyArray<TurnSummary>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("searchTurns").pipe(Effect.annotateLogs({ ...options }));
				const limit = options.limit ?? 100;
				const sessionFilter = options.sessionId !== undefined ? sql` AND session_id = ${options.sessionId}` : sql``;
				const typeFilter = options.type !== undefined ? sql` AND type = ${options.type}` : sql``;
				const sinceFilter = options.since !== undefined ? sql` AND occurred_at >= ${options.since}` : sql``;
				const rows = yield* sql<{
					id: number;
					session_id: number;
					turn_no: number;
					type: string;
					payload: string;
					occurred_at: string;
				}>`SELECT id, session_id, turn_no, type, payload, occurred_at FROM turns WHERE 1=1${sessionFilter}${typeFilter}${sinceFilter} ORDER BY occurred_at DESC, turn_no DESC LIMIT ${limit}`;
				return rows.map((r) => ({
					id: r.id,
					sessionId: r.session_id,
					turnNo: r.turn_no,
					type: r.type,
					payload: r.payload,
					occurredAt: r.occurred_at,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "turns", reason: extractSqlReason(e) })),
			);

		const computeAcceptanceMetrics = (): Effect.Effect<AcceptanceMetrics, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("computeAcceptanceMetrics");

				// Metric 1: phase-evidence integrity — sessions where the
				// first test_failed_run artifact precedes the first
				// code_written artifact (red-before-code).
				const m1 = yield* sql<{ total: number; compliant: number }>`
					WITH task_orderings AS (
						SELECT
							p.tdd_task_id,
							MIN(CASE WHEN a.artifact_kind = 'test_failed_run' THEN a.id END) AS first_failed_run,
							MIN(CASE WHEN a.artifact_kind = 'code_written'    THEN a.id END) AS first_code_written
						FROM tdd_artifacts a
						JOIN tdd_phases p ON a.phase_id = p.id
						WHERE a.artifact_kind IN ('test_failed_run', 'code_written')
						GROUP BY p.tdd_task_id
					)
					SELECT
						COUNT(*) AS total,
						COALESCE(SUM(CASE WHEN first_failed_run < first_code_written THEN 1 ELSE 0 END), 0) AS compliant
					FROM task_orderings
					WHERE first_code_written IS NOT NULL
				`;

				// Metric 2: compliance-hook responsiveness — sessions that
				// fired SessionEnd, PreCompact, or Stop and produced a follow-up
				// note/hypothesis/tdd_session_end tool call.
				const m2 = yield* sql<{ total: number; with_followup: number }>`
					WITH wrap_up_fires AS (
						SELECT t.session_id
						FROM turns t
						WHERE t.type = 'hook_fire'
							AND json_extract(t.payload, '$.hook_kind') IN ('SessionEnd', 'PreCompact', 'Stop')
					),
					followups AS (
						SELECT DISTINCT t.session_id
						FROM turns t
						JOIN tool_invocations ti ON ti.turn_id = t.id
						WHERE ti.tool_name IN ('note', 'hypothesis', 'tdd_task', 'note_create', 'hypothesis_validate', 'tdd_session_end')
					)
					SELECT
						(SELECT COUNT(DISTINCT session_id) FROM wrap_up_fires) AS total,
						(SELECT COUNT(DISTINCT wf.session_id)
							FROM wrap_up_fires wf JOIN followups f ON f.session_id = wf.session_id) AS with_followup
				`;

				// Metric 3: orientation usefulness — sessions with non-empty
				// triage that referenced an orientation tool in their first
				// three completed tool invocations (tool_result turns, numbered
				// sequentially per session via ROW_NUMBER so interleaved
				// user_prompt/tool_call turns don't compress the window).
				const m3 = yield* sql<{ total: number; referenced_count: number }>`
					WITH triaged_sessions AS (
						SELECT id AS session_id FROM sessions WHERE triage_was_non_empty = 1
					),
					ranked_tool_results AS (
						SELECT session_id, id AS turn_id,
							ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_no) AS result_no
						FROM turns
						WHERE type = 'tool_result'
					),
					first_three_tool_calls AS (
						SELECT r.session_id, ti.tool_name
						FROM ranked_tool_results r
						JOIN tool_invocations ti ON ti.turn_id = r.turn_id
						WHERE r.result_no <= 3
					),
					referenced AS (
						SELECT DISTINCT ts.session_id
						FROM triaged_sessions ts
						JOIN first_three_tool_calls ftc ON ftc.session_id = ts.session_id
						WHERE ftc.tool_name IN ('tdd_session_resume', 'run_tests', 'test_history',
							'failure_signature_get', 'tdd_session_start')
					)
					SELECT
						(SELECT COUNT(*) FROM triaged_sessions) AS total,
						(SELECT COUNT(*) FROM referenced) AS referenced_count
				`;

				// Metric 4: anti-pattern detection rate — completed TDD
				// sessions with zero test_weakened artifacts.
				const m4 = yield* sql<{ total: number; clean_sessions: number }>`
					SELECT
						COUNT(*) AS total,
						COALESCE(SUM(CASE WHEN weakened_count = 0 THEN 1 ELSE 0 END), 0) AS clean_sessions
					FROM (
						SELECT ts.id AS tdd_task_id,
							COUNT(a.id) AS weakened_count
						FROM tdd_tasks ts
						LEFT JOIN tdd_phases p ON p.tdd_task_id = ts.id
						LEFT JOIN tdd_artifacts a ON a.phase_id = p.id AND a.artifact_kind = 'test_weakened'
						WHERE ts.ended_at IS NOT NULL
						GROUP BY ts.id
					) tasks_with_counts
				`;

				const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);
				return {
					phaseEvidenceIntegrity: {
						total: m1[0].total,
						compliant: m1[0].compliant,
						ratio: ratio(m1[0].compliant, m1[0].total),
					},
					complianceHookResponsiveness: {
						total: m2[0].total,
						withFollowup: m2[0].with_followup,
						ratio: ratio(m2[0].with_followup, m2[0].total),
					},
					orientationUsefulness: {
						total: m3[0].total,
						referencedCount: m3[0].referenced_count,
						ratio: ratio(m3[0].referenced_count, m3[0].total),
					},
					antiPatternDetectionRate: {
						total: m4[0].total,
						cleanSessions: m4[0].clean_sessions,
						ratio: ratio(m4[0].clean_sessions, m4[0].total),
					},
				};
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) =>
						new DataStoreError({
							operation: "read",
							table: "tdd_tasks",
							reason: extractSqlReason(e),
						}),
				),
			);

		const listSessions = (options: {
			readonly project?: string;
			readonly agentKind?: "main" | "subagent";
			readonly limit?: number;
		}): Effect.Effect<ReadonlyArray<SessionDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listSessions").pipe(Effect.annotateLogs({ ...options }));
				const limit = options.limit ?? 50;
				const project = options.project ?? null;
				const agentKind = options.agentKind ?? null;
				const rows = yield* sql<SessionRow>`
					SELECT id, chat_id, project, cwd, agent_kind, agent_type,
						parent_session_id, triage_was_non_empty, started_at, ended_at, end_reason
					FROM sessions
					WHERE (${project} IS NULL OR project = ${project})
						AND (${agentKind} IS NULL OR agent_kind = ${agentKind})
					ORDER BY started_at DESC
					LIMIT ${limit}
				`;
				return rows.map(sessionRowToDetail);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "sessions", reason: extractSqlReason(e) }),
				),
			);

		const getFailureSignatureByHash = (
			hash: string,
		): Effect.Effect<Option.Option<FailureSignatureDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getFailureSignatureByHash").pipe(Effect.annotateLogs({ hash }));
				const sigRows = yield* sql<{
					signature_hash: string;
					first_seen_run_id: number | null;
					first_seen_at: string;
					last_seen_at: string | null;
					occurrence_count: number;
				}>`
					SELECT signature_hash, first_seen_run_id, first_seen_at, last_seen_at, occurrence_count
					FROM failure_signatures WHERE signature_hash = ${hash} LIMIT 1
				`;
				if (sigRows.length === 0) return Option.none<FailureSignatureDetail>();
				const errRows = yield* sql<{ run_id: number; message: string; name: string | null }>`
					SELECT run_id, message, name FROM test_errors
					WHERE signature_hash = ${hash}
					ORDER BY run_id DESC
					LIMIT 10
				`;
				const sig = sigRows[0];
				return Option.some<FailureSignatureDetail>({
					signatureHash: sig.signature_hash,
					firstSeenRunId: sig.first_seen_run_id,
					firstSeenAt: sig.first_seen_at,
					lastSeenAt: sig.last_seen_at,
					occurrenceCount: sig.occurrence_count,
					recentErrors: errRows.map((e) => ({ runId: e.run_id, message: e.message, errorName: e.name })),
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "failure_signatures", reason: extractSqlReason(e) }),
				),
			);

		interface RawGoalRow {
			id: number;
			session_id: number;
			ordinal: number;
			goal: string;
			status: string;
			created_at: string;
		}

		interface RawBehaviorRow {
			id: number;
			goal_id: number;
			ordinal: number;
			behavior: string;
			suggested_test_name: string | null;
			status: string;
			created_at: string;
		}

		const goalRowFromDb = (row: RawGoalRow) => ({
			id: row.id,
			sessionId: row.session_id,
			ordinal: row.ordinal,
			goal: row.goal,
			status: row.status as GoalStatus,
			createdAt: row.created_at,
		});

		const behaviorRowFromDb = (row: RawBehaviorRow): BehaviorRow => ({
			id: row.id,
			goalId: row.goal_id,
			ordinal: row.ordinal,
			behavior: row.behavior,
			suggestedTestName: row.suggested_test_name,
			status: row.status as BehaviorStatus,
			createdAt: row.created_at,
		});

		const fetchGoalsWithBehaviors = (sessionId: number) =>
			Effect.gen(function* () {
				const goals = yield* sql<RawGoalRow>`
					SELECT id, session_id, ordinal, goal, status, created_at
					FROM tdd_session_goals
					WHERE session_id = ${sessionId}
					ORDER BY ordinal
				`;
				if (goals.length === 0) return [] as ReadonlyArray<GoalDetail>;
				const goalIds = goals.map((g) => g.id);
				const behaviors = yield* sql<RawBehaviorRow>`
					SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
					FROM tdd_session_behaviors
					WHERE goal_id IN ${sql.in(goalIds)}
					ORDER BY goal_id, ordinal
				`;
				const byGoal = new Map<number, BehaviorRow[]>();
				for (const id of goalIds) byGoal.set(id, []);
				for (const b of behaviors) {
					const list = byGoal.get(b.goal_id);
					if (list) list.push(behaviorRowFromDb(b));
				}
				return goals.map<GoalDetail>((g) => ({
					...goalRowFromDb(g),
					behaviors: byGoal.get(g.id) ?? [],
				}));
			});

		const getGoalById = (id: number): Effect.Effect<Option.Option<GoalDetail>, DataStoreError> =>
			Effect.gen(function* () {
				const goalRows = yield* sql<RawGoalRow>`
					SELECT id, session_id, ordinal, goal, status, created_at
					FROM tdd_session_goals
					WHERE id = ${id}
				`;
				if (goalRows.length === 0) return Option.none<GoalDetail>();
				const beh = yield* sql<RawBehaviorRow>`
					SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
					FROM tdd_session_behaviors
					WHERE goal_id = ${id}
					ORDER BY ordinal
				`;
				return Option.some<GoalDetail>({
					...goalRowFromDb(goalRows[0]),
					behaviors: beh.map(behaviorRowFromDb),
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
				),
			);

		const getGoalsByTddTask = (tddTaskId: number): Effect.Effect<ReadonlyArray<GoalDetail>, DataStoreError> =>
			fetchGoalsWithBehaviors(tddTaskId).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_goals", reason: extractSqlReason(e) }),
				),
			);

		const getBehaviorById = (id: number): Effect.Effect<Option.Option<BehaviorDetail>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{
					b_id: number;
					b_goal_id: number;
					b_ordinal: number;
					b_behavior: string;
					b_suggested_test_name: string | null;
					b_status: string;
					b_created_at: string;
					g_id: number;
					g_goal: string;
					g_status: string;
				}>`
					SELECT b.id AS b_id, b.goal_id AS b_goal_id, b.ordinal AS b_ordinal, b.behavior AS b_behavior,
					       b.suggested_test_name AS b_suggested_test_name, b.status AS b_status,
					       b.created_at AS b_created_at,
					       g.id AS g_id, g.goal AS g_goal, g.status AS g_status
					FROM tdd_session_behaviors b
					JOIN tdd_session_goals g ON g.id = b.goal_id
					WHERE b.id = ${id}
				`;
				if (rows.length === 0) return Option.none<BehaviorDetail>();
				const r = rows[0];
				const deps = yield* sql<RawBehaviorRow>`
					SELECT b.id, b.goal_id, b.ordinal, b.behavior, b.suggested_test_name, b.status, b.created_at
					FROM tdd_behavior_dependencies d
					JOIN tdd_session_behaviors b ON b.id = d.depends_on_id
					WHERE d.behavior_id = ${id}
					ORDER BY b.ordinal
				`;
				return Option.some<BehaviorDetail>({
					id: r.b_id,
					goalId: r.b_goal_id,
					ordinal: r.b_ordinal,
					behavior: r.b_behavior,
					suggestedTestName: r.b_suggested_test_name,
					status: r.b_status as BehaviorStatus,
					createdAt: r.b_created_at,
					parentGoal: {
						id: r.g_id,
						goal: r.g_goal,
						status: r.g_status as GoalStatus,
					},
					dependencies: deps.map(behaviorRowFromDb),
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
				),
			);

		const getBehaviorsByGoal = (goalId: number): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<RawBehaviorRow>`
					SELECT id, goal_id, ordinal, behavior, suggested_test_name, status, created_at
					FROM tdd_session_behaviors
					WHERE goal_id = ${goalId}
					ORDER BY ordinal
				`;
				return rows.map(behaviorRowFromDb);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
				),
			);

		const getBehaviorsByTddTask = (tddTaskId: number): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<RawBehaviorRow>`
					SELECT b.id, b.goal_id, b.ordinal, b.behavior, b.suggested_test_name, b.status, b.created_at
					FROM tdd_session_behaviors b
					JOIN tdd_session_goals g ON g.id = b.goal_id
					WHERE g.session_id = ${tddTaskId}
					ORDER BY g.ordinal, b.ordinal
				`;
				return rows.map(behaviorRowFromDb);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
				),
			);

		const getBehaviorDependencies = (behaviorId: number): Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<RawBehaviorRow>`
					SELECT b.id, b.goal_id, b.ordinal, b.behavior, b.suggested_test_name, b.status, b.created_at
					FROM tdd_behavior_dependencies d
					JOIN tdd_session_behaviors b ON b.id = d.depends_on_id
					WHERE d.behavior_id = ${behaviorId}
					ORDER BY b.ordinal
				`;
				return rows.map(behaviorRowFromDb);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) =>
						new DataStoreError({ operation: "read", table: "tdd_behavior_dependencies", reason: extractSqlReason(e) }),
				),
			);

		const resolveGoalIdForBehavior = (behaviorId: number): Effect.Effect<Option.Option<number>, DataStoreError> =>
			Effect.gen(function* () {
				const rows = yield* sql<{ goal_id: number }>`
					SELECT goal_id FROM tdd_session_behaviors WHERE id = ${behaviorId}
				`;
				return rows.length === 0 ? Option.none<number>() : Option.some(rows[0].goal_id);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_session_behaviors", reason: extractSqlReason(e) }),
				),
			);

		const getTddTaskById = (id: number): Effect.Effect<Option.Option<TddTaskDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getTddTaskById").pipe(Effect.annotateLogs({ id }));
				const taskRows = yield* sql<{
					id: number;
					session_id: number;
					goal: string;
					started_at: string;
					ended_at: string | null;
					outcome: string | null;
					run_id: string | null;
				}>`
					SELECT id, session_id, goal, started_at, ended_at, outcome, run_id
					FROM tdd_tasks WHERE id = ${id} LIMIT 1
				`;
				if (taskRows.length === 0) return Option.none<TddTaskDetail>();
				const tddTask = taskRows[0];
				const goals = yield* fetchGoalsWithBehaviors(id);
				const phaseRows = yield* sql<{
					id: number;
					behavior_id: number | null;
					phase: string;
					started_at: string;
					ended_at: string | null;
					transition_reason: string | null;
				}>`
					SELECT id, behavior_id, phase, started_at, ended_at, transition_reason
					FROM tdd_phases WHERE tdd_task_id = ${id}
					ORDER BY started_at ASC
				`;
				const artifactRows = yield* sql<{
					id: number;
					phase_id: number;
					artifact_kind: string;
					test_case_id: number | null;
					test_run_id: number | null;
					recorded_at: string;
				}>`
					SELECT a.id, a.phase_id, a.artifact_kind, a.test_case_id, a.test_run_id, a.recorded_at
					FROM tdd_artifacts a
					JOIN tdd_phases p ON a.phase_id = p.id
					WHERE p.tdd_task_id = ${id}
					ORDER BY a.recorded_at ASC
				`;
				return Option.some<TddTaskDetail>({
					id: tddTask.id,
					sessionId: tddTask.session_id,
					goal: tddTask.goal,
					startedAt: tddTask.started_at,
					endedAt: tddTask.ended_at,
					outcome: tddTask.outcome,
					runId: tddTask.run_id,
					goals,
					phases: phaseRows.map((p) => ({
						id: p.id,
						behaviorId: p.behavior_id,
						phase: p.phase,
						startedAt: p.started_at,
						endedAt: p.ended_at,
						transitionReason: p.transition_reason,
					})),
					artifacts: artifactRows.map((a) => ({
						id: a.id,
						phaseId: a.phase_id,
						artifactKind: a.artifact_kind,
						testCaseId: a.test_case_id,
						testRunId: a.test_run_id,
						recordedAt: a.recorded_at,
					})),
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_tasks", reason: extractSqlReason(e) }),
				),
			);

		const getCurrentTddPhase = (tddTaskId: number): Effect.Effect<Option.Option<CurrentTddPhase>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getCurrentTddPhase").pipe(Effect.annotateLogs({ tddTaskId }));
				const rows = yield* sql<{
					id: number;
					phase: string;
					started_at: string;
					behavior_id: number | null;
				}>`
					SELECT id, phase, started_at, behavior_id FROM tdd_phases
					WHERE tdd_task_id = ${tddTaskId} AND ended_at IS NULL
					ORDER BY started_at DESC LIMIT 1
				`;
				if (rows.length === 0) return Option.none<CurrentTddPhase>();
				return Option.some<CurrentTddPhase>({
					id: rows[0].id,
					phase: rows[0].phase as Phase,
					startedAt: rows[0].started_at,
					behaviorId: rows[0].behavior_id,
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_phases", reason: extractSqlReason(e) }),
				),
			);

		const getTddArtifactWithContext = (
			artifactId: number,
		): Effect.Effect<Option.Option<CitedArtifactRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getTddArtifactWithContext").pipe(Effect.annotateLogs({ artifactId }));
				const rows = yield* sql<{
					id: number;
					phase_id: number;
					artifact_kind: string;
					test_case_id: number | null;
					test_case_created_turn_at: string | null;
					test_case_authored_in_session: number;
					test_run_id: number | null;
					test_first_failure_run_id: number | null;
					behavior_id: number | null;
				}>`
					SELECT
						a.id,
						a.phase_id,
						a.artifact_kind,
						a.test_case_id,
						ttc.occurred_at AS test_case_created_turn_at,
						CASE
							WHEN ttc.session_id = sess.id THEN 1
							ELSE 0
						END AS test_case_authored_in_session,
						a.test_run_id,
						a.test_first_failure_run_id,
						p.behavior_id
					FROM tdd_artifacts a
					JOIN tdd_phases p ON p.id = a.phase_id
					JOIN tdd_tasks ts ON ts.id = p.tdd_task_id
					JOIN sessions sess ON sess.id = ts.session_id
					LEFT JOIN test_cases tc ON tc.id = a.test_case_id
					LEFT JOIN turns ttc ON ttc.id = tc.created_turn_id
					WHERE a.id = ${artifactId}
				`;
				if (rows.length === 0) return Option.none<CitedArtifactRow>();
				const r = rows[0];
				return Option.some<CitedArtifactRow>({
					id: r.id,
					phase_id: r.phase_id,
					artifact_kind: r.artifact_kind as ArtifactKind,
					test_case_id: r.test_case_id,
					test_case_created_turn_at: r.test_case_created_turn_at,
					test_case_authored_in_session: r.test_case_authored_in_session === 1,
					test_run_id: r.test_run_id,
					test_first_failure_run_id: r.test_first_failure_run_id,
					behavior_id: r.behavior_id,
				});
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_artifacts", reason: extractSqlReason(e) }),
				),
			);

		const getCommitChanges = (sha?: string): Effect.Effect<ReadonlyArray<CommitChangesEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getCommitChanges").pipe(Effect.annotateLogs({ sha: sha ?? "ALL" }));

				const commitRows =
					sha !== undefined
						? yield* sql<{
								sha: string;
								parent_sha: string | null;
								message: string | null;
								author: string | null;
								committed_at: string | null;
								branch: string | null;
							}>`SELECT sha, parent_sha, message, author, committed_at, branch FROM commits WHERE sha = ${sha}`
						: yield* sql<{
								sha: string;
								parent_sha: string | null;
								message: string | null;
								author: string | null;
								committed_at: string | null;
								branch: string | null;
							}>`
							SELECT sha, parent_sha, message, author, committed_at, branch FROM commits
							ORDER BY committed_at DESC NULLS LAST LIMIT 20
						`;

				const out: CommitChangesEntry[] = [];
				for (const c of commitRows) {
					const fileRows = yield* sql<{ path: string; change_kind: string }>`
						SELECT f.path, rcf.change_kind
						FROM run_changed_files rcf
						JOIN files f ON f.id = rcf.file_id
						WHERE rcf.commit_sha = ${c.sha}
					`;
					out.push({
						sha: c.sha,
						parentSha: c.parent_sha,
						message: c.message,
						author: c.author,
						committedAt: c.committed_at,
						branch: c.branch,
						files: fileRows.map((r) => ({
							filePath: r.path,
							changeKind: r.change_kind as ChangeKind,
						})),
					});
				}
				return out;
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "commits", reason: extractSqlReason(e) }),
				),
			);

		const listTddTasksForSession = (
			sessionId: number,
			options?: { readonly walkParents?: boolean },
		): Effect.Effect<ReadonlyArray<TddTaskSummary>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listTddTasksForSession").pipe(
					Effect.annotateLogs({ sessionId, walkParents: options?.walkParents ?? false }),
				);
				// When `walkParents`, collect the ancestor chain via
				// parent_session_id. Bound the loop by table size to
				// avoid infinite loops if a cycle were ever introduced.
				const sessionIds: number[] = [sessionId];
				if (options?.walkParents === true) {
					let currentId: number | null = sessionId;
					for (let i = 0; i < 64 && currentId !== null; i++) {
						const parentRows: ReadonlyArray<{ parent_session_id: number | null }> = yield* sql<{
							parent_session_id: number | null;
						}>`
								SELECT parent_session_id FROM sessions WHERE id = ${currentId} LIMIT 1
							`;
						const next: number | null = parentRows[0]?.parent_session_id ?? null;
						if (next === null || sessionIds.includes(next)) break;
						sessionIds.push(next);
						currentId = next;
					}
				}
				const rows = yield* sql<{
					id: number;
					session_id: number;
					goal: string;
					started_at: string;
					ended_at: string | null;
					outcome: string | null;
				}>`
					SELECT id, session_id, goal, started_at, ended_at, outcome FROM tdd_tasks
					WHERE session_id IN ${sql.in(sessionIds)} ORDER BY started_at DESC
				`;
				return rows.map((r) => ({
					id: r.id,
					sessionId: r.session_id,
					goal: r.goal,
					startedAt: r.started_at,
					endedAt: r.ended_at,
					outcome: r.outcome as TddTaskSummary["outcome"],
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_tasks", reason: extractSqlReason(e) }),
				),
			);

		const listTddArtifactsForTask = (input: {
			readonly tddTaskId: number;
			readonly artifactKind?: ArtifactKind;
			readonly phaseId?: number;
			readonly behaviorId?: number;
			readonly limit?: number;
		}): Effect.Effect<ReadonlyArray<TddArtifactRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listTddArtifactsForTask").pipe(Effect.annotateLogs(input));
				const limit = input.limit ?? 50;
				const rows = yield* sql<{
					id: number;
					tdd_task_id: number;
					phase_id: number;
					phase_name: string;
					artifact_kind: string;
					behavior_id: number | null;
					test_case_id: number | null;
					test_run_id: number | null;
					test_first_failure_run_id: number | null;
					recorded_at: string;
				}>`
					SELECT
						a.id,
						p.tdd_task_id AS tdd_task_id,
						a.phase_id,
						p.phase AS phase_name,
						a.artifact_kind,
						p.behavior_id,
						a.test_case_id,
						a.test_run_id,
						a.test_first_failure_run_id,
						a.recorded_at
					FROM tdd_artifacts a
					JOIN tdd_phases p ON p.id = a.phase_id
					WHERE p.tdd_task_id = ${input.tddTaskId}
						AND (${input.artifactKind ?? null} IS NULL OR a.artifact_kind = ${input.artifactKind ?? null})
						AND (${input.phaseId ?? null} IS NULL OR a.phase_id = ${input.phaseId ?? null})
						AND (${input.behaviorId ?? null} IS NULL OR p.behavior_id = ${input.behaviorId ?? null})
					ORDER BY a.recorded_at DESC, a.id DESC
					LIMIT ${limit}
				`;
				return rows.map((r) => ({
					id: r.id,
					tddTaskId: r.tdd_task_id,
					phaseId: r.phase_id,
					phaseName: r.phase_name as Phase,
					artifactKind: r.artifact_kind as ArtifactKind,
					behaviorId: r.behavior_id,
					testCaseId: r.test_case_id,
					testRunId: r.test_run_id,
					testFirstFailureRunId: r.test_first_failure_run_id,
					recordedAt: r.recorded_at,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "tdd_artifacts", reason: extractSqlReason(e) }),
				),
			);

		const listHypotheses = (options: {
			readonly sessionId?: number;
			readonly outcome?: "confirmed" | "refuted" | "abandoned" | "open";
			readonly limit?: number;
		}): Effect.Effect<ReadonlyArray<HypothesisDetail>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listHypotheses").pipe(Effect.annotateLogs({ ...options }));
				const limit = options.limit ?? 50;
				const sessionId = options.sessionId ?? null;
				const outcome = options.outcome ?? null;
				const rows = yield* sql<{
					id: number;
					session_id: number;
					content: string;
					cited_test_error_id: number | null;
					cited_stack_frame_id: number | null;
					validation_outcome: string | null;
					validated_at: string | null;
				}>`
					SELECT id, session_id, content, cited_test_error_id, cited_stack_frame_id,
						validation_outcome, validated_at
					FROM hypotheses
					WHERE (${sessionId} IS NULL OR session_id = ${sessionId})
						AND (
							${outcome} IS NULL
							OR (${outcome} = 'open' AND validation_outcome IS NULL)
							OR (${outcome} != 'open' AND validation_outcome = ${outcome})
						)
					ORDER BY id DESC
					LIMIT ${limit}
				`;
				return rows.map((r) => ({
					id: r.id,
					sessionId: r.session_id,
					content: r.content,
					citedTestErrorId: r.cited_test_error_id,
					citedStackFrameId: r.cited_stack_frame_id,
					validationOutcome: r.validation_outcome as "confirmed" | "refuted" | "abandoned" | null,
					validatedAt: r.validated_at,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) => new DataStoreError({ operation: "read", table: "hypotheses", reason: extractSqlReason(e) }),
				),
			);

		const findIdempotentResponse = (
			procedurePath: string,
			key: string,
		): Effect.Effect<Option.Option<string>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("findIdempotentResponse").pipe(Effect.annotateLogs({ procedurePath, key }));
				const rows = yield* sql<{
					result_json: string;
				}>`
					SELECT result_json FROM mcp_idempotent_responses
					WHERE procedure_path = ${procedurePath} AND key = ${key}
					LIMIT 1
				`;
				return rows.length === 0 ? Option.none() : Option.some(rows[0].result_json);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) =>
						new DataStoreError({
							operation: "read",
							table: "mcp_idempotent_responses",
							reason: extractSqlReason(e),
						}),
				),
			);

		const getLatestTestCaseForSession = (chatId: string): Effect.Effect<Option.Option<number>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("getLatestTestCaseForSession").pipe(Effect.annotateLogs({ chatId }));
				// Find the most-recently-added test case (from the latest run) whose
				// module file was edited in the given session. Uses LIKE suffix-matching
				// because the reporter stores relative paths while hooks store absolute.
				const rows = yield* sql<{ id: number }>`
					SELECT tc.id
					FROM test_cases tc
					JOIN test_modules tm ON tc.module_id = tm.id
					JOIN files f_mod ON f_mod.id = tm.file_id
					WHERE tm.run_id = (SELECT id FROM test_runs ORDER BY id DESC LIMIT 1)
					  AND EXISTS (
						SELECT 1
						FROM file_edits fe
						JOIN turns t ON fe.turn_id = t.id
						JOIN sessions s ON t.session_id = s.id
						JOIN files f_edit ON fe.file_id = f_edit.id
						WHERE s.chat_id = ${chatId}
						  AND (
							f_edit.path = f_mod.path
							OR f_edit.path LIKE '%/' || f_mod.path
							OR f_mod.path LIKE '%/' || f_edit.path
						  )
					  )
					ORDER BY tc.id DESC
					LIMIT 1
				`;
				return rows.length === 0 ? Option.none() : Option.some(rows[0].id);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError(
					(e) =>
						new DataStoreError({
							operation: "read",
							table: "test_cases",
							reason: extractSqlReason(e),
						}),
				),
			);

		const listTagInventory = (options?: {
			readonly project?: string;
		}): Effect.Effect<ReadonlyArray<TagInventoryRow>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listTagInventory").pipe(Effect.annotateLogs({ project: options?.project }));

				if (options?.project) {
					// Project-scoped: find the latest run for the specific project, then
					// count test cases carrying each tag in that run.
					const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
						WHERE project = ${options.project}
						ORDER BY timestamp DESC LIMIT 1`;

					if (runs.length === 0) return [];
					const runId = runs[0].id;

					const rows = yield* sql<{
						tag: string;
						project: string;
						module_count: number;
						test_count: number;
					}>`
						SELECT t.name AS tag, ${options.project} AS project,
							COUNT(DISTINCT tm.id) AS module_count,
							COUNT(tc.id) AS test_count
						FROM test_cases tc
						JOIN test_modules tm ON tm.id = tc.module_id
						JOIN test_case_tags tct ON tct.test_case_id = tc.id
						JOIN tags t ON t.id = tct.tag_id
						WHERE tm.run_id = ${runId}
						GROUP BY t.name
						ORDER BY t.name
					`;

					return rows.map((r) => ({
						tag: r.tag,
						project: r.project,
						moduleCount: r.module_count,
						testCount: r.test_count,
					}));
				}

				// Unscoped: for each project find its latest run, then aggregate tags.
				// Uses a subquery to pick the max(timestamp) run per project so that
				// only the most recent run contributes to the inventory.
				const rows = yield* sql<{
					tag: string;
					project: string;
					module_count: number;
					test_count: number;
				}>`
					SELECT t.name AS tag, tr.project AS project,
						COUNT(DISTINCT tm.id) AS module_count,
						COUNT(tc.id) AS test_count
					FROM test_runs tr
					JOIN (
						SELECT project, MAX(timestamp) AS max_ts
						FROM test_runs
						GROUP BY project
					) latest ON tr.project = latest.project AND tr.timestamp = latest.max_ts
					JOIN test_modules tm ON tm.run_id = tr.id
					JOIN test_cases tc ON tc.module_id = tm.id
					JOIN test_case_tags tct ON tct.test_case_id = tc.id
					JOIN tags t ON t.id = tct.tag_id
					GROUP BY tr.project, t.name
					ORDER BY tr.project, t.name
				`;

				return rows.map((r) => ({
					tag: r.tag,
					project: r.project,
					moduleCount: r.module_count,
					testCount: r.test_count,
				}));
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "tags", reason: extractSqlReason(e) })),
			);

		const listTestsForTag = (
			tag: string,
			options?: { readonly project?: string },
		): Effect.Effect<ReadonlyArray<TestListEntry>, DataStoreError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug("listTestsForTag").pipe(Effect.annotateLogs({ tag, project: options?.project }));

				if (options?.project) {
					// Project-scoped
					const runs = yield* sql<{ id: number }>`SELECT id FROM test_runs
						WHERE project = ${options.project}
						ORDER BY timestamp DESC LIMIT 1`;

					if (runs.length === 0) return [];
					const runId = runs[0].id;

					const rows = yield* sql<{
						id: number;
						full_name: string;
						state: string;
						duration: number | null;
						file_path: string;
						classification: string | null;
					}>`
						SELECT tc.id, tc.full_name, tc.state, tc.duration, f.path AS file_path, tc.classification
						FROM test_cases tc
						JOIN test_modules tm ON tm.id = tc.module_id
						JOIN files f ON f.id = tm.file_id
						JOIN test_case_tags tct ON tct.test_case_id = tc.id
						JOIN tags t ON t.id = tct.tag_id
						WHERE tm.run_id = ${runId} AND t.name = ${tag}
						ORDER BY tc.full_name
					`;

					return rows.map(mapTestListRow);
				}

				// Unscoped: one result set across all projects' latest runs
				const rows = yield* sql<{
					id: number;
					full_name: string;
					state: string;
					duration: number | null;
					file_path: string;
					classification: string | null;
				}>`
					SELECT tc.id, tc.full_name, tc.state, tc.duration, f.path AS file_path, tc.classification
					FROM test_runs tr
					JOIN (
						SELECT project, MAX(timestamp) AS max_ts
						FROM test_runs
						GROUP BY project
					) latest ON tr.project = latest.project AND tr.timestamp = latest.max_ts
					JOIN test_modules tm ON tm.run_id = tr.id
					JOIN files f ON f.id = tm.file_id
					JOIN test_cases tc ON tc.module_id = tm.id
					JOIN test_case_tags tct ON tct.test_case_id = tc.id
					JOIN tags t ON t.id = tct.tag_id
					WHERE t.name = ${tag}
					ORDER BY tr.project, tc.full_name
				`;

				return rows.map(mapTestListRow);
			}).pipe(
				Effect.annotateLogs("service", "DataReader"),
				Effect.mapError((e) => new DataStoreError({ operation: "read", table: "tags", reason: extractSqlReason(e) })),
			);

		return {
			getLatestRun,
			getRunsByProject,
			getHistory,
			getBaselines,
			getTrends,
			getFlaky,
			getPersistentFailures,
			getFileCoverage,
			getCoverage,
			getTestsForFile,
			getErrors,
			getNotes,
			getNoteById,
			searchNotes,
			getManifest,
			getSettings,
			getLatestSettings,
			getTestByFullName,
			listTests,
			listModules,
			listSuites,
			listSettings,
			getSessionById,
			getSessionByChatId,
			findSessionsByChatPrefix,
			listSessions,
			searchTurns,
			computeAcceptanceMetrics,
			getFailureSignatureByHash,
			getTddTaskById,
			getGoalById,
			getGoalsByTddTask,
			getBehaviorById,
			getBehaviorsByGoal,
			getBehaviorsByTddTask,
			getBehaviorDependencies,
			resolveGoalIdForBehavior,
			getCurrentTddPhase,
			getTddArtifactWithContext,
			getCommitChanges,
			listTddTasksForSession,
			listTddArtifactsForTask,
			listHypotheses,
			findIdempotentResponse,
			getLatestTestCaseForSession,
			listTagInventory,
			listTestsForTag,
		};
	}),
);

// Internal DB row shape for notes table
interface NoteDbRow {
	readonly id: number;
	readonly title: string;
	readonly content: string;
	readonly scope: string;
	readonly project: string | null;
	readonly test_full_name: string | null;
	readonly module_path: string | null;
	readonly parent_note_id: number | null;
	readonly created_by: string | null;
	readonly expires_at: string | null;
	readonly pinned: number;
	readonly created_at: string;
	readonly updated_at: string;
}

function mapTestListRow(row: {
	id: number;
	full_name: string;
	state: string;
	duration: number | null;
	file_path: string;
	classification: string | null;
}): TestListEntry {
	return {
		id: row.id,
		fullName: row.full_name,
		state: row.state,
		duration: row.duration,
		module: row.file_path,
		classification: row.classification,
	};
}

function mapNoteRow(row: NoteDbRow): NoteRow {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		scope: row.scope as NoteRow["scope"],
		project: row.project,
		testFullName: row.test_full_name,
		modulePath: row.module_path,
		parentNoteId: row.parent_note_id,
		createdBy: row.created_by,
		expiresAt: row.expires_at,
		pinned: row.pinned === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
