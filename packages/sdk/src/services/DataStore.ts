import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { AgentNotFoundError, RegistrationConflictError } from "../errors/AgentErrors.js";
import type { DataStoreError } from "../errors/DataStoreError.js";
import type {
	BehaviorNotFoundError,
	GoalNotFoundError,
	IllegalStatusTransitionError,
	TddTaskAlreadyEndedError,
	TddTaskNotFoundError,
} from "../errors/TddErrors.js";
import type { Agent, IdempotencyHit } from "../schemas/Agent.js";
import type { CoverageBaselines } from "../schemas/Baselines.js";
import type { BehaviorRow, BehaviorStatus, GoalRow, GoalStatus } from "../schemas/Tdd.js";
import type { TrendEntry } from "../schemas/Trends.js";
import type { ArtifactKind, Phase } from "../utils/validate-phase-transition.js";

export type { ArtifactKind, Phase };

/** @public */
export interface CreateGoalInput {
	readonly tddTaskId: number;
	readonly goal: string;
}
/** @public */
export interface UpdateGoalInput {
	readonly id: number;
	readonly goal?: string;
	readonly status?: GoalStatus;
}
/** @public */
export interface CreateBehaviorInput {
	readonly goalId: number;
	readonly behavior: string;
	readonly suggestedTestName?: string;
	readonly dependsOnBehaviorIds?: ReadonlyArray<number>;
}
/** @public */
export interface UpdateBehaviorInput {
	readonly id: number;
	readonly behavior?: string;
	readonly suggestedTestName?: string | null;
	readonly status?: BehaviorStatus;
	readonly dependsOnBehaviorIds?: ReadonlyArray<number>;
}
/** @public */
export interface SettingsInput {
	readonly vitestVersion: string;
	readonly pool?: string;
	readonly environment?: string;
	readonly testTimeout?: number;
	readonly hookTimeout?: number;
	readonly slowTestThreshold?: number;
	readonly maxConcurrency?: number;
	readonly maxWorkers?: number;
	readonly isolate?: boolean;
	readonly bail?: number;
	readonly globals?: boolean;
	readonly fileParallelism?: boolean;
	readonly sequenceSeed?: number;
	readonly coverageProvider?: string;
}
/** @public */
export interface TestRunInput {
	readonly invocationId: string;
	readonly project: string;
	readonly settingsHash: string;
	readonly timestamp: string;
	readonly commitSha: string | null;
	readonly branch: string | null;
	readonly reason: "passed" | "failed" | "interrupted";
	readonly duration: number;
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly scoped: boolean;
	readonly snapshotAdded?: number;
	readonly snapshotMatched?: number;
	readonly snapshotUnmatched?: number;
	readonly snapshotUpdated?: number;
	readonly snapshotUnchecked?: number;
	readonly snapshotTotal?: number;
	readonly snapshotFailure?: boolean;
	readonly snapshotDidUpdate?: boolean;
	readonly snapshotFilesAdded?: number;
	readonly snapshotFilesRemoved?: number;
	readonly snapshotFilesUnmatched?: number;
	readonly snapshotFilesUpdated?: number;
	/**
	 * Attribution columns added by the agent-agnostic taxonomy work. The
	 * reporter walks env vars / session map to populate these; un-attributed
	 * runs default to actor_type='system' and NULL agent/conversation ids.
	 */
	readonly actorType?: "agent" | "user" | "system";
	readonly agentId?: string | null;
	readonly conversationId?: string | null;
	/**
	 * Git context the run executed against. NULL for non-git workspaces.
	 */
	readonly gitBranch?: string | null;
	readonly gitCommitSha?: string | null;
	readonly gitDirty?: boolean | null;
	readonly gitUpstream?: string | null;
	readonly gitWorktreeDir?: string | null;
	/**
	 * Host metadata probe result (terminal pane, CI runner). NULL when no
	 * probe in the priority chain matched.
	 * @public
	 */
	readonly hostSource?: string | null;
	readonly hostValue?: string | null;
	readonly hostMetadata?: Record<string, unknown> | null;
}
/** @public */
export interface ModuleInput {
	readonly fileId: number;
	readonly relativeModuleId: string;
	readonly state: string;
	readonly duration?: number;
	readonly environmentSetupDuration?: number;
	readonly prepareDuration?: number;
	readonly collectDuration?: number;
	readonly setupDuration?: number;
	readonly heap?: number;
}
/** @public */
export interface TestCaseInput {
	readonly suiteId?: number;
	readonly vitestId?: string;
	readonly name: string;
	readonly fullName: string;
	readonly state: string;
	readonly classification?: string;
	readonly duration?: number;
	readonly startTime?: number;
	readonly flaky?: boolean;
	readonly slow?: boolean;
	readonly retryCount?: number;
	readonly repeatCount?: number;
	readonly heap?: number;
	readonly mode?: string;
	readonly each?: boolean;
	readonly fails?: boolean;
	readonly concurrent?: boolean;
	readonly shuffle?: boolean;
	readonly timeout?: number;
	readonly skipNote?: string;
	readonly locationLine?: number;
	readonly locationColumn?: number;
	readonly tags?: readonly string[];
	/**
	 * FK to `turns(id)`. Set by the reporter when the test case row was
	 * authored within a recorded turn (D2 binding rule 1).
	 * @public
	 */
	readonly createdTurnId?: number;
}
/** @public */
export interface StackFrameInput {
	readonly ordinal: number;
	readonly method: string | null;
	readonly filePath: string;
	readonly line: number;
	readonly col: number;
	readonly sourceMappedLine?: number;
	readonly functionBoundaryLine?: number;
}
/** @public */
export interface TestErrorInput {
	readonly testCaseId?: number;
	readonly testSuiteId?: number;
	readonly moduleId?: number;
	readonly scope: "test" | "suite" | "module" | "unhandled";
	readonly name?: string;
	readonly message: string;
	readonly diff?: string;
	readonly actual?: string;
	readonly expected?: string;
	readonly stack?: string;
	readonly causeErrorId?: number;
	readonly signatureHash?: string;
	readonly frames?: ReadonlyArray<StackFrameInput>;
	readonly ordinal?: number;
}
/** @public */
export interface FileCoverageInput {
	readonly fileId: number;
	readonly statements: number;
	readonly branches: number;
	readonly functions: number;
	readonly lines: number;
	readonly uncoveredLines?: string;
	/**
	 * Coverage tier this row represents. `'below_threshold'` is the
	 * build-failing tier (file falls below the configured minimum
	 * coverage thresholds). `'below_target'` is the warning tier (file
	 * is above thresholds but below the aspirational target).
	 *
	 * Defaults to `'below_threshold'` when omitted, matching the only
	 * tier that existed before migration 0005.
	 * @public
	 */
	readonly tier?: "below_threshold" | "below_target";
}
/** @public */
export interface SuiteInput {
	readonly parentSuiteId?: number;
	readonly name: string;
	readonly fullName: string;
	readonly state: "pending" | "passed" | "failed" | "skipped";
	readonly mode?: "run" | "only" | "skip" | "todo";
	readonly concurrent?: boolean;
	readonly shuffle?: boolean;
	readonly retry?: number;
	readonly repeats?: number;
	readonly locationLine?: number;
	readonly locationColumn?: number;
}
/** @public */
export interface NoteInput {
	readonly title: string;
	readonly content: string;
	readonly scope: "global" | "project" | "module" | "suite" | "test" | "note";
	readonly project?: string;
	readonly testFullName?: string;
	readonly modulePath?: string;
	readonly parentNoteId?: number;
	readonly createdBy?: string;
	readonly expiresAt?: string;
	readonly pinned?: boolean;
}
/** @public */
export interface SessionInput {
	readonly chatId: string;
	readonly project: string;
	readonly cwd: string;
	readonly agentKind: "main" | "subagent";
	readonly agentType?: string;
	readonly parentSessionId?: number;
	readonly triageWasNonEmpty?: boolean;
	readonly startedAt: string;
}
/** @public */
export interface TurnInput {
	readonly sessionId: number;
	/** When omitted, writeTurn computes MAX(turnNo) + 1 for the session. */
	readonly turnNo?: number;
	readonly type: "user_prompt" | "tool_call" | "tool_result" | "file_edit" | "hook_fire" | "note" | "hypothesis";
	readonly payload: string; // pre-stringified JSON, validated by record CLI
	readonly occurredAt: string;
}
/** @public */
export interface FailureSignatureWriteInput {
	readonly signatureHash: string;
	readonly runId: number;
	readonly seenAt: string;
}
/** @public */
export interface HypothesisInput {
	readonly sessionId: number;
	readonly content: string;
	readonly createdTurnId?: number;
	readonly citedTestErrorId?: number;
	readonly citedStackFrameId?: number;
}
/** @public */
export interface ValidateHypothesisInput {
	readonly id: number;
	readonly outcome: "confirmed" | "refuted" | "abandoned";
	readonly validatedTurnId?: number;
	readonly validatedAt: string;
}
/** @public */
export interface IdempotentResponseInput {
	readonly procedurePath: string;
	readonly key: string;
	readonly resultJson: string;
	readonly createdAt: string;
}
/** @public */
export interface TddTaskInput {
	readonly sessionId: number;
	readonly goal: string;
	readonly startedAt: string;
	readonly parentTddTaskId?: number;
	readonly runId?: string;
}
/** @public */
export interface EndTddTaskInput {
	readonly id: number;
	readonly endedAt: string;
	readonly outcome: "succeeded" | "blocked" | "abandoned";
	readonly summaryNoteId?: number;
}
/** @public */
export interface WriteTddPhaseInput {
	readonly tddTaskId: number;
	readonly behaviorId?: number;
	readonly phase: Phase;
	readonly startedAt: string;
	readonly transitionReason?: string;
	readonly parentPhaseId?: number;
}
/** @public */
export interface WriteTddPhaseOutput {
	readonly id: number;
	readonly previousPhaseId: number | null;
}
/** @public */
export interface WriteTddArtifactInput {
	readonly phaseId: number;
	readonly artifactKind: ArtifactKind;
	readonly fileId?: number;
	readonly testCaseId?: number;
	readonly testRunId?: number;
	readonly testFirstFailureRunId?: number;
	readonly diffExcerpt?: string;
	readonly recordedAt: string;
}
/** @public */
export interface WriteCommitInput {
	readonly sha: string;
	readonly parentSha?: string;
	readonly message?: string;
	readonly author?: string;
	readonly committedAt?: string;
	readonly branch?: string;
}
/** @public */
export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked-modified";
/** @public */
export interface RunChangedFile {
	readonly filePath: string;
	readonly changeKind: ChangeKind;
	readonly commitSha?: string;
}
/** @public */
export interface WriteRunChangedFilesInput {
	readonly runId: number;
	readonly files: ReadonlyArray<RunChangedFile>;
}
/** @public */
export type RunInvocationMethod = "bash" | "mcp" | "cli";

// chatId is the host's chat UUID string; the live layer resolves it to
// sessions.id (integer PK) before writing run_triggers.agent_session_id.
/**
 * Input to `DataStore.registerAgent`.
 *
 * `sessionId` is the FK to `sessions.id` (integer PK), NOT the host's
 * chat UUID string. Callers that hold only the chat UUID must resolve
 * it through `getSessionByChatId` first.
 *
 * `idempotencyKey` is pre-derived by the caller via
 * `deriveIdempotencyKey(...)` — both the sidecar CLI and the MCP
 * server compute it the same way so a hook retry collapses to the
 * same row.
 * @public
 */
export interface RegisterAgentInput {
	readonly sessionId: number;
	readonly agentType: string;
	readonly parentAgentId: string | null;
	readonly conversationId: string | null;
	readonly startedAt: number;
	readonly startGitBranch?: string;
	readonly startGitCommitSha?: string;
	readonly startWorktreeDir?: string;
	readonly idempotencyKey: string;
	/**
	 * Pre-allocated `agents.agent_id` UUID. The sidecar passes
	 * `PerClientSessionMapWriter.mapSession()`'s `main_agent_id` here so
	 * the per-project `agents` row and the per-client session_map row
	 * agree on a single canonical id — the same value the SessionStart
	 * hook exports as `VITEST_AGENT_MAIN_AGENT_ID` / `_AGENT_ID`. When
	 * omitted, the implementation generates a fresh UUID (used by tests
	 * and any caller without a session map).
	 */
	readonly agentId?: string;
}
/** @public */
export interface AssociateRunSessionInput {
	readonly chatId: string;
	readonly invocationMethod: RunInvocationMethod;
}
/** @public */
export class DataStore extends Context.Tag("vitest-agent/DataStore")<
	DataStore,
	{
		readonly writeSettings: (
			hash: string,
			settings: SettingsInput,
			envVars: Record<string, string>,
		) => Effect.Effect<void, DataStoreError>;
		readonly writeRun: (input: TestRunInput) => Effect.Effect<number, DataStoreError>;
		readonly writeModules: (
			runId: number,
			modules: ReadonlyArray<ModuleInput>,
		) => Effect.Effect<ReadonlyArray<number>, DataStoreError>;
		readonly writeSuites: (
			moduleId: number,
			suites: ReadonlyArray<SuiteInput>,
		) => Effect.Effect<ReadonlyArray<number>, DataStoreError>;
		readonly writeTestCases: (
			moduleId: number,
			tests: ReadonlyArray<TestCaseInput>,
		) => Effect.Effect<ReadonlyArray<number>, DataStoreError>;
		readonly writeErrors: (runId: number, errors: ReadonlyArray<TestErrorInput>) => Effect.Effect<void, DataStoreError>;
		readonly writeCoverage: (
			runId: number,
			coverage: ReadonlyArray<FileCoverageInput>,
		) => Effect.Effect<void, DataStoreError>;
		readonly writeHistory: (
			project: string,
			fullName: string,
			runId: number,
			timestamp: string,
			state: string,
			duration: number | null,
			flaky: boolean,
			retryCount: number,
			errorMessage: string | null,
		) => Effect.Effect<void, DataStoreError>;
		readonly writeBaselines: (baselines: CoverageBaselines) => Effect.Effect<void, DataStoreError>;
		readonly writeTrends: (project: string, runId: number, entry: TrendEntry) => Effect.Effect<void, DataStoreError>;
		readonly writeSourceMap: (
			sourceFilePath: string,
			testModuleId: number,
			mappingType: string,
		) => Effect.Effect<void, DataStoreError>;
		readonly ensureFile: (filePath: string) => Effect.Effect<number, DataStoreError>;
		readonly writeNote: (note: NoteInput) => Effect.Effect<number, DataStoreError>;
		readonly updateNote: (id: number, fields: Partial<NoteInput>) => Effect.Effect<void, DataStoreError>;
		readonly deleteNote: (id: number) => Effect.Effect<void, DataStoreError>;
		readonly writeSession: (input: SessionInput) => Effect.Effect<number, DataStoreError>;
		/**
		 * Idempotent variant of `writeSession`: if a row with this
		 * `chat_id` already exists, return its id and leave the stored
		 * fields untouched; otherwise insert a new row. Used by
		 * hook-triggered recording paths (artifacts, turns) that fire
		 * for sessions whose original `SessionStart` may have missed —
		 * e.g. when Claude Code rotates `chat_id` mid-window after a
		 * continuation or compaction. Race-safe via
		 * `INSERT ... ON CONFLICT DO NOTHING`.
		 */
		readonly upsertSession: (input: SessionInput) => Effect.Effect<number, DataStoreError>;
		readonly writeTurn: (input: TurnInput) => Effect.Effect<number, DataStoreError>;
		readonly writeFailureSignature: (input: FailureSignatureWriteInput) => Effect.Effect<void, DataStoreError>;
		readonly endSession: (
			chatId: string,
			endedAt: string,
			endReason: string | null,
		) => Effect.Effect<void, DataStoreError>;
		readonly writeHypothesis: (input: HypothesisInput) => Effect.Effect<number, DataStoreError>;
		readonly validateHypothesis: (input: ValidateHypothesisInput) => Effect.Effect<void, DataStoreError>;
		readonly writeTddTask: (input: TddTaskInput) => Effect.Effect<number, DataStoreError>;
		readonly endTddTask: (input: EndTddTaskInput) => Effect.Effect<void, DataStoreError>;
		readonly createGoal: (
			input: CreateGoalInput,
		) => Effect.Effect<GoalRow, DataStoreError | TddTaskNotFoundError | TddTaskAlreadyEndedError>;
		readonly getGoal: (id: number) => Effect.Effect<Option.Option<GoalRow>, DataStoreError>;
		readonly updateGoal: (
			input: UpdateGoalInput,
		) => Effect.Effect<
			GoalRow,
			DataStoreError | GoalNotFoundError | TddTaskAlreadyEndedError | IllegalStatusTransitionError
		>;
		readonly deleteGoal: (id: number) => Effect.Effect<void, DataStoreError | GoalNotFoundError>;
		readonly listGoalsByTddTask: (
			tddTaskId: number,
		) => Effect.Effect<ReadonlyArray<GoalRow>, DataStoreError | TddTaskNotFoundError>;
		readonly createBehavior: (
			input: CreateBehaviorInput,
		) => Effect.Effect<
			BehaviorRow,
			| DataStoreError
			| GoalNotFoundError
			| BehaviorNotFoundError
			| TddTaskAlreadyEndedError
			| IllegalStatusTransitionError
		>;
		readonly getBehavior: (id: number) => Effect.Effect<Option.Option<BehaviorRow>, DataStoreError>;
		readonly updateBehavior: (
			input: UpdateBehaviorInput,
		) => Effect.Effect<
			BehaviorRow,
			DataStoreError | BehaviorNotFoundError | TddTaskAlreadyEndedError | IllegalStatusTransitionError
		>;
		readonly deleteBehavior: (id: number) => Effect.Effect<void, DataStoreError | BehaviorNotFoundError>;
		readonly listBehaviorsByGoal: (
			goalId: number,
		) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError | GoalNotFoundError>;
		readonly listBehaviorsByTddTask: (
			tddTaskId: number,
		) => Effect.Effect<ReadonlyArray<BehaviorRow>, DataStoreError | TddTaskNotFoundError>;
		readonly writeTddPhase: (input: WriteTddPhaseInput) => Effect.Effect<WriteTddPhaseOutput, DataStoreError>;
		readonly writeTddArtifact: (input: WriteTddArtifactInput) => Effect.Effect<number, DataStoreError>;
		readonly writeCommit: (input: WriteCommitInput) => Effect.Effect<void, DataStoreError>;
		readonly writeRunChangedFiles: (input: WriteRunChangedFilesInput) => Effect.Effect<void, DataStoreError>;
		readonly recordIdempotentResponse: (input: IdempotentResponseInput) => Effect.Effect<void, DataStoreError>;
		readonly pruneSessions: (
			keepRecent: number,
		) => Effect.Effect<{ readonly affectedSessions: number; readonly prunedTurns: number }, DataStoreError>;
		readonly associateLatestRunWithSession: (input: AssociateRunSessionInput) => Effect.Effect<void, DataStoreError>;
		readonly backfillTestCaseTurns: (chatId: string) => Effect.Effect<number, DataStoreError>;
		/**
		 * Idempotently insert an `agents` row.
		 *
		 * Returns `Agent` on a fresh insert, or `IdempotencyHit` carrying
		 * the existing `agentId` when the `(session_id, idempotency_key)`
		 * UNIQUE constraint already has a row. The caller treats the latter
		 * as a successful recovery (same logical agent), not an error.
		 *
		 * Fails with `RegistrationConflictError` when the supplied
		 * `parentAgentId` references an agent in a different session, or
		 * when no such agent exists. Surface to the caller for true
		 * mis-configuration cases; idempotency hits never produce this.
		 */
		readonly registerAgent: (
			input: RegisterAgentInput,
		) => Effect.Effect<Agent | IdempotencyHit, RegistrationConflictError | DataStoreError>;
		/**
		 * Mark an agent as ended. Sets `agents.ended_at` to the supplied
		 * timestamp. Fails with `AgentNotFoundError` when no row exists.
		 */
		readonly endAgent: (agentId: string, endedAt: number) => Effect.Effect<void, AgentNotFoundError | DataStoreError>;
	}
>() {}
