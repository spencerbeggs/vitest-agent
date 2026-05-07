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
import type { CitedArtifact } from "../utils/validate-phase-transition.js";
import type { ChangeKind, Phase } from "./DataStore.js";

export interface ProjectRunSummary {
	readonly project: string;
	readonly subProject: string | null;
	readonly lastRun: string | null;
	readonly lastResult: "passed" | "failed" | "interrupted" | null;
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
}

export interface FlakyTest {
	readonly fullName: string;
	readonly project: string;
	readonly subProject: string | null;
	readonly passCount: number;
	readonly failCount: number;
	readonly lastState: "passed" | "failed";
	readonly lastTimestamp: string;
}

export interface PersistentFailure {
	readonly fullName: string;
	readonly project: string;
	readonly subProject: string | null;
	readonly consecutiveFailures: number;
	readonly firstFailedAt: string;
	readonly lastFailedAt: string;
	readonly lastErrorMessage: string | null;
}

export interface TestError {
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

export interface NoteRow {
	readonly id: number;
	readonly title: string;
	readonly content: string;
	readonly scope: "global" | "project" | "module" | "suite" | "test" | "note";
	readonly project: string | null;
	readonly subProject: string | null;
	readonly testFullName: string | null;
	readonly modulePath: string | null;
	readonly parentNoteId: number | null;
	readonly createdBy: string | null;
	readonly expiresAt: string | null;
	readonly pinned: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

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

export interface TestListEntry {
	readonly id: number;
	readonly fullName: string;
	readonly state: string;
	readonly duration: number | null;
	readonly module: string;
	readonly classification: string | null;
}

export interface ModuleListEntry {
	readonly id: number;
	readonly file: string;
	readonly state: string;
	readonly testCount: number;
	readonly duration: number | null;
}

export interface SuiteListEntry {
	readonly id: number;
	readonly name: string;
	readonly module: string;
	readonly state: string;
	readonly testCount: number;
}

export interface SettingsListEntry {
	readonly hash: string;
	readonly capturedAt: string;
}

export interface SessionDetail {
	readonly id: number;
	readonly cc_session_id: string;
	readonly project: string;
	readonly subProject: string | null;
	readonly cwd: string;
	readonly agentKind: "main" | "subagent";
	readonly agentType: string | null;
	readonly parentSessionId: number | null;
	readonly triageWasNonEmpty: boolean;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly endReason: string | null;
}

export interface TurnSummary {
	readonly id: number;
	readonly sessionId: number;
	readonly turnNo: number;
	readonly type: string;
	readonly payload: string;
	readonly occurredAt: string;
}

export interface TurnSearchOptions {
	readonly sessionId?: number;
	readonly type?: string;
	readonly since?: string;
	readonly limit?: number;
}

export interface AcceptanceMetrics {
	readonly phaseEvidenceIntegrity: { total: number; compliant: number; ratio: number };
	readonly complianceHookResponsiveness: { total: number; withFollowup: number; ratio: number };
	readonly orientationUsefulness: { total: number; referencedCount: number; ratio: number };
	readonly antiPatternDetectionRate: { total: number; cleanSessions: number; ratio: number };
}

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

export interface TddPhaseDetail {
	readonly id: number;
	readonly behaviorId: number | null;
	readonly phase: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly transitionReason: string | null;
}

export interface TddArtifactDetail {
	readonly id: number;
	readonly phaseId: number;
	readonly artifactKind: string;
	readonly testCaseId: number | null;
	readonly testRunId: number | null;
	readonly recordedAt: string;
}

export interface TddSessionDetail {
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

export interface CurrentTddPhase {
	readonly id: number;
	readonly phase: Phase;
	readonly startedAt: string;
	readonly behaviorId: number | null;
}

export interface CitedArtifactRow extends CitedArtifact {
	readonly phase_id: number;
}

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

export interface HypothesisDetail {
	readonly id: number;
	readonly sessionId: number;
	readonly content: string;
	readonly citedTestErrorId: number | null;
	readonly citedStackFrameId: number | null;
	readonly validationOutcome: "confirmed" | "refuted" | "abandoned" | null;
	readonly validatedAt: string | null;
}

export interface TddSessionSummary {
	readonly id: number;
	readonly sessionId: number;
	readonly goal: string;
	readonly startedAt: string;
	readonly endedAt: string | null;
	readonly outcome: "succeeded" | "blocked" | "abandoned" | null;
}

export class DataReader extends Context.Tag("vitest-agent/DataReader")<
	DataReader,
	{
		readonly getLatestRun: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<Option.Option<AgentReport>, DataStoreError>;
		readonly getRunsByProject: () => Effect.Effect<ReadonlyArray<ProjectRunSummary>, DataStoreError>;
		readonly getHistory: (project: string, subProject: string | null) => Effect.Effect<HistoryRecord, DataStoreError>;
		readonly getBaselines: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<Option.Option<CoverageBaselines>, DataStoreError>;
		readonly getTrends: (
			project: string,
			subProject: string | null,
			limit?: number,
		) => Effect.Effect<Option.Option<TrendRecord>, DataStoreError>;
		readonly getFlaky: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<ReadonlyArray<FlakyTest>, DataStoreError>;
		readonly getPersistentFailures: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<ReadonlyArray<PersistentFailure>, DataStoreError>;
		readonly getFileCoverage: (runId: number) => Effect.Effect<ReadonlyArray<FileCoverageReport>, DataStoreError>;
		readonly getCoverage: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<Option.Option<CoverageReport>, DataStoreError>;
		readonly getTestsForFile: (filePath: string) => Effect.Effect<ReadonlyArray<string>, DataStoreError>;
		readonly getErrors: (
			project: string,
			subProject: string | null,
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
			subProject: string | null,
			fullName: string,
		) => Effect.Effect<Option.Option<TestListEntry>, DataStoreError>;
		readonly listTests: (
			project: string,
			subProject: string | null,
			options?: { state?: string; module?: string; limit?: number },
		) => Effect.Effect<ReadonlyArray<TestListEntry>, DataStoreError>;
		readonly listModules: (
			project: string,
			subProject: string | null,
		) => Effect.Effect<ReadonlyArray<ModuleListEntry>, DataStoreError>;
		readonly listSuites: (
			project: string,
			subProject: string | null,
			options?: { module?: string },
		) => Effect.Effect<ReadonlyArray<SuiteListEntry>, DataStoreError>;
		readonly listSettings: () => Effect.Effect<ReadonlyArray<SettingsListEntry>, DataStoreError>;
		readonly getSessionById: (id: number) => Effect.Effect<Option.Option<SessionDetail>, DataStoreError>;
		readonly getSessionByCcId: (ccSessionId: string) => Effect.Effect<Option.Option<SessionDetail>, DataStoreError>;
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
		readonly getTddSessionById: (id: number) => Effect.Effect<Option.Option<TddSessionDetail>, DataStoreError>;
		readonly getGoalById: (id: number) => Effect.Effect<Option.Option<GoalDetail>, DataStoreError>;
		readonly getGoalsBySession: (sessionId: number) => Effect.Effect<ReadonlyArray<GoalDetail>, DataStoreError>;
		readonly getBehaviorById: (id: number) => Effect.Effect<Option.Option<BehaviorDetail>, DataStoreError>;
		readonly getBehaviorsByGoal: (goalId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly getBehaviorsBySession: (sessionId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly getBehaviorDependencies: (behaviorId: number) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError>;
		readonly resolveGoalIdForBehavior: (behaviorId: number) => Effect.Effect<Option.Option<number>, DataStoreError>;
		readonly getCurrentTddPhase: (
			tddSessionId: number,
		) => Effect.Effect<Option.Option<CurrentTddPhase>, DataStoreError>;
		readonly getTddArtifactWithContext: (
			artifactId: number,
		) => Effect.Effect<Option.Option<CitedArtifactRow>, DataStoreError>;
		readonly getCommitChanges: (sha?: string) => Effect.Effect<ReadonlyArray<CommitChangesEntry>, DataStoreError>;
		readonly listTddSessionsForSession: (
			sessionId: number,
		) => Effect.Effect<ReadonlyArray<TddSessionSummary>, DataStoreError>;
		readonly listHypotheses: (options: {
			readonly sessionId?: number;
			readonly outcome?: "confirmed" | "refuted" | "abandoned" | "open";
			readonly limit?: number;
		}) => Effect.Effect<ReadonlyArray<HypothesisDetail>, DataStoreError>;
		readonly findIdempotentResponse: (
			procedurePath: string,
			key: string,
		) => Effect.Effect<Option.Option<string>, DataStoreError>;
		readonly getLatestTestCaseForSession: (ccSessionId: string) => Effect.Effect<Option.Option<number>, DataStoreError>;
	}
>() {}
