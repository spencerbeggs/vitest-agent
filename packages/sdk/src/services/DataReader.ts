import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { DataStoreError } from "../errors/DataStoreError.js";
import type { AgentReport } from "../schemas/AgentReport.js";
import type { CoverageBaselines } from "../schemas/Baselines.js";
import type { CacheManifest } from "../schemas/CacheManifest.js";
import type { CoverageReport, FileCoverageReport } from "../schemas/Coverage.js";
import type { HistoryRecord } from "../schemas/History.js";
import type { BehaviorDetail, BehaviorRow, GoalDetail } from "../schemas/Tdd.js";
import type { TrendRecord } from "../schemas/Trends.js";
import type { ArtifactKind, CitedArtifact } from "../utils/validate-phase-transition.js";
import type { ChangeKind, Phase } from "./DataStore.js";

/** @public */
export interface ProjectRunSummary {
	readonly project: string;
	readonly lastRun: string | null;
	readonly lastResult: "passed" | "failed" | "interrupted" | null;
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
}
/** @public */
export interface FlakyTest {
	readonly fullName: string;
	readonly modulePath: string;
	readonly project: string;
	readonly passCount: number;
	readonly failCount: number;
	readonly lastState: "passed" | "failed";
	readonly lastTimestamp: string;
}
/** @public */
export interface PersistentFailure {
	readonly fullName: string;
	readonly modulePath: string;
	readonly project: string;
	readonly consecutiveFailures: number;
	readonly firstFailedAt: string;
	readonly lastFailedAt: string;
	readonly lastErrorMessage: string | null;
}
/** @public */
export interface TestError {
	/** `test_errors.id` — required by `hypothesis (action: record).citedTestErrorId`. */
	readonly id: number;
	/**
	 * `stack_frames.id` for the top frame of this error (ordinal 0), or
	 * `null` if no frames were captured. Required by
	 * `hypothesis (action: record).citedStackFrameId`.
	 */
	readonly topStackFrameId: number | null;
	readonly name: string | null;
	readonly message: string;
	readonly diff: string | null;
	readonly actual: string | null;
	readonly expected: string | null;
	readonly stack: string | null;
	readonly scope: "test" | "suite" | "module" | "unhandled";
	readonly testFullName: string | null;
	readonly moduleFile: string | null;
}
/** @public */
export interface NoteRow {
	readonly id: number;
	readonly title: string;
	readonly content: string;
	readonly scope: "global" | "project" | "module" | "suite" | "test" | "note";
	readonly project: string | null;
	readonly testFullName: string | null;
	readonly modulePath: string | null;
	readonly parentNoteId: number | null;
	readonly createdBy: string | null;
	readonly expiresAt: string | null;
	readonly pinned: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}
/** @public */
export interface SettingsRow {
	readonly hash: string;
	readonly reporters: string | null;
	readonly coverageEnabled: boolean;
	readonly coverageProvider: string | null;
	readonly coverageThresholds: string | null;
	readonly coverageTargets: string | null;
	readonly pool: string | null;
	readonly shard: string | null;
	readonly project: string | null;
	readonly environment: string | null;
	readonly envVars: Record<string, string>;
	readonly capturedAt: string;
}
/** @public */
export interface TestListEntry {
	readonly id: number;
	readonly fullName: string;
	readonly state: string;
	readonly duration: number | null;
	readonly module: string;
	readonly classification: string | null;
}
/** @public */
export interface ModuleListEntry {
	readonly id: number;
	readonly file: string;
	readonly state: string;
	readonly testCount: number;
	readonly duration: number | null;
}
/** @public */
export interface SuiteListEntry {
	readonly id: number;
	readonly name: string;
	readonly module: string;
	readonly state: string;
	readonly testCount: number;
}
/** @public */
export interface SettingsListEntry {
	readonly hash: string;
	readonly capturedAt: string;
}
/** @public */
export interface SessionDetail {
	readonly id: number;
	readonly chatId: string;
	readonly project: string;
	readonly cwd: string;
	readonly agentKind: "main" | "subagent";
	readonly agentType: string | null;
	readonly parentSessionId: number | null;
	readonly triageWasNonEmpty: boolean;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly endReason: string | null;
}
/** @public */
export interface TurnSummary {
	readonly id: number;
	readonly sessionId: number;
	readonly turnNo: number;
	readonly type: string;
	readonly payload: string;
	readonly occurredAt: string;
}
/** @public */
export interface TurnSearchOptions {
	readonly sessionId?: number;
	readonly type?: string;
	readonly since?: string;
	readonly limit?: number;
}
/** @public */
export interface AcceptanceMetrics {
	readonly phaseEvidenceIntegrity: { total: number; compliant: number; ratio: number };
	readonly complianceHookResponsiveness: { total: number; withFollowup: number; ratio: number };
	readonly orientationUsefulness: { total: number; referencedCount: number; ratio: number };
	readonly antiPatternDetectionRate: { total: number; cleanSessions: number; ratio: number };
}
/** @public */
export interface FailureSignatureDetail {
	readonly signatureHash: string;
	readonly firstSeenRunId: number | null;
	readonly firstSeenAt: string;
	readonly lastSeenAt: string | null;
	readonly occurrenceCount: number;
	readonly recentErrors: ReadonlyArray<{
		readonly runId: number;
		readonly message: string;
		readonly errorName: string | null;
	}>;
}
/** @public */
export interface TddPhaseDetail {
	readonly id: number;
	readonly behaviorId: number | null;
	readonly phase: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly transitionReason: string | null;
}
/** @public */
export interface TddArtifactDetail {
	readonly id: number;
	readonly phaseId: number;
	readonly artifactKind: string;
	readonly testCaseId: number | null;
	readonly testRunId: number | null;
	readonly recordedAt: string;
}
/** @public */
export interface TddTaskDetail {
	readonly id: number;
	readonly sessionId: number;
	readonly goal: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly outcome: string | null;
	readonly runId: string | null;
	readonly goals: ReadonlyArray<GoalDetail>;
	readonly phases: ReadonlyArray<TddPhaseDetail>;
	readonly artifacts: ReadonlyArray<TddArtifactDetail>;
}
/** @public */
export interface CurrentTddPhase {
	readonly id: number;
	readonly phase: Phase;
	readonly startedAt: string;
	readonly behaviorId: number | null;
}
/** @public */
export interface CitedArtifactRow extends CitedArtifact {
	readonly phase_id: number;
}
/** @public */
export interface CommitChangesEntry {
	readonly sha: string;
	readonly parentSha: string | null;
	readonly message: string | null;
	readonly author: string | null;
	readonly committedAt: string | null;
	readonly branch: string | null;
	readonly files: ReadonlyArray<{
		readonly filePath: string;
		readonly changeKind: ChangeKind;
	}>;
}
/** @public */
export interface HypothesisDetail {
	readonly id: number;
	readonly sessionId: number;
	readonly content: string;
	readonly citedTestErrorId: number | null;
	readonly citedStackFrameId: number | null;
	readonly validationOutcome: "confirmed" | "refuted" | "abandoned" | null;
	readonly validatedAt: string | null;
}
/** @public */
export interface TddTaskSummary {
	readonly id: number;
	readonly sessionId: number;
	readonly goal: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly outcome: "succeeded" | "blocked" | "abandoned" | null;
}

/**
 * Row shape returned by `listTddArtifactsForTask`. Carries every
 * field an agent typically needs to cite an artifact in a subsequent
 * `tdd_phase_transition_request` call without further lookups.
 *
 * @public
 */
export interface TddArtifactRow {
	readonly id: number;
	readonly tddTaskId: number;
	readonly phaseId: number;
	readonly phaseName: Phase;
	readonly artifactKind: ArtifactKind;
	readonly behaviorId: number | null;
	readonly testCaseId: number | null;
	readonly testRunId: number | null;
	readonly testFirstFailureRunId: number | null;
	readonly recordedAt: string;
}
/** @public */
export interface TagInventoryRow {
	/** The tag name (e.g. `"int"`, `"e2e"`, `"unit"`). */
	readonly tag: string;
	/** The Vitest project this tag was observed in. */
	readonly project: string;
	/**
	 * Number of distinct test modules in the project's latest run that contain
	 * at least one test case carrying this tag.
	 */
	readonly moduleCount: number;
	/**
	 * Number of test cases in the project's latest run that carry this tag.
	 */
	readonly testCount: number;
}
/** @public */
export class DataReader extends Context.Tag("vitest-agent/DataReader")<
	DataReader,
	{
		readonly getLatestRun: (project: string) => Effect.Effect<Option.Option<AgentReport>, DataStoreError>;
		readonly getRunsByProject: () => Effect.Effect<ReadonlyArray<ProjectRunSummary>, DataStoreError>;
		readonly getHistory: (project: string) => Effect.Effect<HistoryRecord, DataStoreError>;
		readonly getBaselines: (project: string) => Effect.Effect<Option.Option<CoverageBaselines>, DataStoreError>;
		readonly getTrends: (project: string, limit?: number) => Effect.Effect<Option.Option<TrendRecord>, DataStoreError>;
		readonly getFlaky: (project: string) => Effect.Effect<ReadonlyArray<FlakyTest>, DataStoreError>;
		readonly getPersistentFailures: (
			project: string,
		) => Effect.Effect<ReadonlyArray<PersistentFailure>, DataStoreError>;
		readonly getFileCoverage: (runId: number) => Effect.Effect<ReadonlyArray<FileCoverageReport>, DataStoreError>;
		readonly getCoverage: (project: string) => Effect.Effect<Option.Option<CoverageReport>, DataStoreError>;
		readonly getTestsForFile: (filePath: string) => Effect.Effect<ReadonlyArray<string>, DataStoreError>;
		readonly getErrors: (
			project: string,
			errorName?: string,
		) => Effect.Effect<ReadonlyArray<TestError>, DataStoreError>;
		readonly getNotes: (
			scope?: string,
			project?: string,
			testFullName?: string,
		) => Effect.Effect<ReadonlyArray<NoteRow>, DataStoreError>;
		readonly getNoteById: (id: number) => Effect.Effect<Option.Option<NoteRow>, DataStoreError>;
		readonly searchNotes: (query: string) => Effect.Effect<ReadonlyArray<NoteRow>, DataStoreError>;
		readonly getManifest: () => Effect.Effect<Option.Option<CacheManifest>, DataStoreError>;
		readonly getSettings: (hash: string) => Effect.Effect<Option.Option<SettingsRow>, DataStoreError>;
		readonly getLatestSettings: () => Effect.Effect<Option.Option<SettingsRow>, DataStoreError>;
		readonly getTestByFullName: (
			project: string,
			fullName: string,
		) => Effect.Effect<Option.Option<TestListEntry>, DataStoreError>;
		readonly listTests: (
			project: string,
			options?: { state?: string; module?: string; limit?: number },
		) => Effect.Effect<ReadonlyArray<TestListEntry>, DataStoreError>;
		readonly listModules: (project: string) => Effect.Effect<ReadonlyArray<ModuleListEntry>, DataStoreError>;
		readonly listSuites: (
			project: string,
			options?: { module?: string },
		) => Effect.Effect<ReadonlyArray<SuiteListEntry>, DataStoreError>;
		readonly listSettings: () => Effect.Effect<ReadonlyArray<SettingsListEntry>, DataStoreError>;
		readonly getSessionById: (id: number) => Effect.Effect<Option.Option<SessionDetail>, DataStoreError>;
		readonly getSessionByChatId: (chatId: string) => Effect.Effect<Option.Option<SessionDetail>, DataStoreError>;
		/**
		 * Find every session row whose `chat_id` begins with `prefix`.
		 * Used to recover the synthetic subagent row created by the
		 * SubagentStart hook (`<parentChatId>-subagent-<ts>-<pid>`)
		 * when subsequent PostToolUse hooks fire under the bare
		 * parent chat_id. Returns most recent first.
		 */
		readonly findSessionsByChatPrefix: (prefix: string) => Effect.Effect<ReadonlyArray<SessionDetail>, DataStoreError>;
		/**
		 * Find the most-recently-started subagent session whose
		 * `parent_session_id` is `parentSessionId` and that has not ended
		 * (`ended_at IS NULL`). Used to attribute orchestrator (subagent)
		 * MCP writes — e.g. `hypothesis record` — to the running subagent's
		 * own session row instead of the parent main session, since the MCP
		 * server's recovered context only ever names the main agent.
		 */
		readonly findActiveSubagentSession: (
			parentSessionId: number,
		) => Effect.Effect<Option.Option<SessionDetail>, DataStoreError>;
		readonly listSessions: (options: {
			readonly project?: string;
			readonly agentKind?: "main" | "subagent";
			readonly limit?: number;
		}) => Effect.Effect<ReadonlyArray<SessionDetail>, DataStoreError>;
		readonly searchTurns: (options: TurnSearchOptions) => Effect.Effect<ReadonlyArray<TurnSummary>, DataStoreError>;
		readonly computeAcceptanceMetrics: () => Effect.Effect<AcceptanceMetrics, DataStoreError>;
		readonly getFailureSignatureByHash: (
			hash: string,
		) => Effect.Effect<Option.Option<FailureSignatureDetail>, DataStoreError>;
		readonly getTddTaskById: (id: number) => Effect.Effect<Option.Option<TddTaskDetail>, DataStoreError>;
		readonly getGoalById: (id: number) => Effect.Effect<Option.Option<GoalDetail>, DataStoreError>;
		readonly getGoalsByTddTask: (tddTaskId: number) => Effect.Effect<ReadonlyArray<GoalDetail>, DataStoreError>;
		readonly getBehaviorById: (id: number) => Effect.Effect<Option.Option<BehaviorDetail>, DataStoreError>;
		readonly getBehaviorsByGoal: (goalId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly getBehaviorsByTddTask: (tddTaskId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly getBehaviorDependencies: (behaviorId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly resolveGoalIdForBehavior: (behaviorId: number) => Effect.Effect<Option.Option<number>, DataStoreError>;
		readonly getCurrentTddPhase: (tddTaskId: number) => Effect.Effect<Option.Option<CurrentTddPhase>, DataStoreError>;
		readonly getTddArtifactWithContext: (
			artifactId: number,
		) => Effect.Effect<Option.Option<CitedArtifactRow>, DataStoreError>;
		readonly getCommitChanges: (sha?: string) => Effect.Effect<ReadonlyArray<CommitChangesEntry>, DataStoreError>;
		readonly listTddTasksForSession: (
			sessionId: number,
			options?: {
				/**
				 * When true, also return tdd_tasks belonging to any
				 * ancestor of `sessionId` via `parent_session_id`. Used
				 * by hook-driven artifact recording where the
				 * orchestrator opened the tdd task under the parent
				 * main row but the subagent's own session row is the
				 * one carrying the calling chat_id. Default `false`
				 * preserves the prior single-session contract.
				 */
				readonly walkParents?: boolean;
			},
		) => Effect.Effect<ReadonlyArray<TddTaskSummary>, DataStoreError>;
		/**
		 * List artifacts recorded for a TDD task, optionally filtered
		 * by `artifactKind`, `phaseId`, or `behaviorId`. Returns rows in
		 * recorded_at DESC order so the most recently captured artifact
		 * (the typical citation target for a phase transition) appears
		 * first. `limit` defaults to 50.
		 */
		readonly listTddArtifactsForTask: (input: {
			readonly tddTaskId: number;
			readonly artifactKind?: ArtifactKind;
			readonly phaseId?: number;
			readonly behaviorId?: number;
			readonly limit?: number;
		}) => Effect.Effect<ReadonlyArray<TddArtifactRow>, DataStoreError>;
		readonly listHypotheses: (options: {
			readonly sessionId?: number;
			readonly outcome?: "confirmed" | "refuted" | "abandoned" | "open";
			readonly limit?: number;
		}) => Effect.Effect<ReadonlyArray<HypothesisDetail>, DataStoreError>;
		readonly findIdempotentResponse: (
			procedurePath: string,
			key: string,
		) => Effect.Effect<Option.Option<string>, DataStoreError>;
		readonly getLatestTestCaseForSession: (chatId: string) => Effect.Effect<Option.Option<number>, DataStoreError>;
		/**
		 * Returns one `TagInventoryRow` per `(tag, project)` pair observed in
		 * each project's latest test run. When `project` is supplied, results
		 * are restricted to that project's latest run.
		 */
		readonly listTagInventory: (options?: {
			readonly project?: string;
		}) => Effect.Effect<ReadonlyArray<TagInventoryRow>, DataStoreError>;
		/**
		 * Returns every `TestListEntry` from the latest run of each project
		 * (or the specified project) whose test case carries `tag`.
		 */
		readonly listTestsForTag: (
			tag: string,
			options?: { readonly project?: string },
		) => Effect.Effect<ReadonlyArray<TestListEntry>, DataStoreError>;
	}
>() {}
