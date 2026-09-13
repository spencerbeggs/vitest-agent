// Lib function for the `record tdd-artifact` CLI subcommand.
//
// Per Decision D7, artifact writes go through the CLI (driven by
// PostToolUse hooks) -- never through MCP. The hook supplies the
// host chat id; this lib resolves the active TDD phase for that
// session and writes the artifact under it.

import type { ArtifactKind, ArtifactSuite, DataStoreError } from "@vitest-agent/sdk";
import type { FileSystem } from "effect";
import { Effect, Option } from "effect";
import { DataReader } from "../services/DataReader.js";
import { DataStore } from "../services/DataStore.js";
import { resolveSessionForRecording } from "./resolve-session-for-recording.js";

/**
 * Input for {@link recordTddArtifactEffect}: an artifact keyed by the host
 * chat id, resolved to the open TDD task under that session.
 *
 * @public
 */
export interface RecordTddArtifactInput {
	/** Host chat id whose open TDD task receives the artifact. */
	readonly chatId: string;
	/** Kind of evidence being recorded. */
	readonly artifactKind: ArtifactKind;
	/** `files.id` the artifact refers to, when file-scoped. */
	readonly fileId?: number;
	/** `test_cases.id` the artifact refers to, when test-scoped. */
	readonly testCaseId?: number;
	/** `test_runs.id` that produced the evidence. */
	readonly testRunId?: number;
	/** Run id of the first observed failure for a red-phase artifact. */
	readonly testFirstFailureRunId?: number;
	/** Short diff excerpt attached to the artifact. */
	readonly diffExcerpt?: string;
	/** ISO-8601 timestamp of the artifact. */
	readonly recordedAt: string;
	/** Issue #363: explicit suite marker. Defaults to `"vitest"` when omitted. */
	readonly suite?: ArtifactSuite;
	/**
	 * Working directory of the calling process (ambient input — the CLI
	 * command passes its own `process.cwd()` when no `--cwd` flag was
	 * given). Used to bootstrap a missing session row when the chat id
	 * has no exact match.
	 */
	readonly cwd: string;
	/**
	 * Project name for bootstrapped session rows. When omitted, the
	 * resolver reads `package.json#name` from `cwd`.
	 */
	readonly project?: string;
}

/**
 * Result of a TDD artifact write: the new artifact row and the phase it landed under.
 *
 * @public
 */
export interface RecordTddArtifactResult {
	/** The new `tdd_artifacts.id`. */
	readonly id: number;
	/** The `tdd_phases.id` the artifact was written under. */
	readonly phaseId: number;
}

/**
 * Resolve (auto-opening a `spike` phase if needed) the current open
 * phase for `tddTaskId`, then write the artifact under it. Shared by
 * both `recordTddArtifactEffect` (chat-id → session → task resolution)
 * and `recordTddArtifactByTaskIdEffect` (explicit task-id escape hatch).
 */
const writeArtifactUnderOpenPhase = (
	tddTaskId: number,
	input: Pick<
		RecordTddArtifactInput,
		| "artifactKind"
		| "fileId"
		| "testCaseId"
		| "testRunId"
		| "testFirstFailureRunId"
		| "diffExcerpt"
		| "recordedAt"
		| "suite"
	>,
): Effect.Effect<RecordTddArtifactResult, DataStoreError, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const store = yield* DataStore;

		const phaseOpt = yield* reader.getCurrentTddPhase(tddTaskId);
		const phaseId = Option.isSome(phaseOpt)
			? phaseOpt.value.id
			: (yield* store.writeTddPhase({
					tddTaskId,
					phase: "spike",
					startedAt: input.recordedAt,
					transitionReason: "auto-opened by record tdd-artifact (no prior phase)",
				})).id;

		const id = yield* store.writeTddArtifact({
			phaseId,
			artifactKind: input.artifactKind,
			...(input.fileId !== undefined && { fileId: input.fileId }),
			...(input.testCaseId !== undefined && { testCaseId: input.testCaseId }),
			...(input.testRunId !== undefined && { testRunId: input.testRunId }),
			...(input.testFirstFailureRunId !== undefined && {
				testFirstFailureRunId: input.testFirstFailureRunId,
			}),
			...(input.diffExcerpt !== undefined && { diffExcerpt: input.diffExcerpt }),
			...(input.suite !== undefined && { suite: input.suite }),
			recordedAt: input.recordedAt,
		});

		return { id, phaseId };
	});

/**
 * Record a TDD artifact under the open TDD task for `chatId`, walking
 * parent and conversation links to find the task and auto-opening a
 * `spike` phase when the task has none.
 *
 * @param input - the artifact to record, keyed by host chat id
 * @public
 */
export const recordTddArtifactEffect = (
	input: RecordTddArtifactInput,
): Effect.Effect<RecordTddArtifactResult, DataStoreError | Error, DataReader | DataStore | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const session = yield* resolveSessionForRecording({
			chatId: input.chatId,
			recordedAt: input.recordedAt,
			...(input.project !== undefined && { project: input.project }),
			cwd: input.cwd,
		});

		// Find the TDD task(s) under this session OR any of its
		// ancestors via `parent_session_id`. Subagent dispatches commonly
		// open the tdd task under the parent main row but PostToolUse
		// hooks fire under the subagent's own row — without the parent
		// walk, the lookup misses the tdd task entirely.
		//
		// `walkConversation` covers the residual detached-session case
		// (issue #144): a named-teammate or otherwise parent-link-less
		// session whose row shares `conversation_id` with the session
		// that opened the task. No-ops when the session's
		// `conversation_id` is null.
		const tddTasks = yield* reader.listTddTasksForSession(session.id, {
			walkParents: true,
			walkConversation: true,
		});
		const openTdd = tddTasks.find((t) => t.endedAt === null);
		if (openTdd === undefined) {
			return yield* Effect.fail(
				new Error(`No open TDD task under chat_id ${input.chatId}. Call tdd_task start first.`),
			);
		}

		// A brand-new TDD task has no open phase. The orchestrator
		// can't bootstrap one via `tdd_phase_transition_request`
		// either, because that endpoint requires a cited artifact id —
		// and recording the first artifact requires an open phase. Open
		// a `spike` phase on demand to break the deadlock. Per α D11,
		// `spike` is the entry point for every TDD cycle and is
		// accepted by the validator unconditionally, so this matches
		// what the orchestrator would have done as its first formal
		// transition once the cycle is running.
		return yield* writeArtifactUnderOpenPhase(openTdd.id, input);
	});

/**
 * Input for {@link recordTddArtifactByTaskIdEffect}: an artifact keyed by an
 * explicit TDD task id.
 *
 * @public
 */
export interface RecordTddArtifactByTaskIdInput {
	/** The `tdd_tasks.id` that receives the artifact. */
	readonly tddTaskId: number;
	/** Kind of evidence being recorded. */
	readonly artifactKind: ArtifactKind;
	/** `files.id` the artifact refers to, when file-scoped. */
	readonly fileId?: number;
	/** `test_cases.id` the artifact refers to, when test-scoped. */
	readonly testCaseId?: number;
	/** `test_runs.id` that produced the evidence. */
	readonly testRunId?: number;
	/** Run id of the first observed failure for a red-phase artifact. */
	readonly testFirstFailureRunId?: number;
	/** Short diff excerpt attached to the artifact. */
	readonly diffExcerpt?: string;
	/** ISO-8601 timestamp of the artifact. */
	readonly recordedAt: string;
	/** Issue #363: explicit suite marker. Defaults to `"vitest"` when omitted. */
	readonly suite?: ArtifactSuite;
}

/**
 * Explicit task-id escape hatch (issue #144). Bypasses `chat_id` →
 * session → task resolution entirely — the caller already knows which
 * TDD task the artifact belongs to (e.g. a hook seeded with
 * `VITEST_AGENT_TDD_TASK_ID` in a detached-session environment where
 * neither the parent walk nor the conversation-id fallback resolves
 * the right task). Fails loudly when the task does not exist or has
 * already ended — writing to a closed task's phase would silently
 * corrupt the evidence trail.
 *
 * @param input - the artifact to record, keyed by TDD task id
 * @public
 */
export const recordTddArtifactByTaskIdEffect = (
	input: RecordTddArtifactByTaskIdInput,
): Effect.Effect<RecordTddArtifactResult, DataStoreError | Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const taskOpt = yield* reader.getTddTaskById(input.tddTaskId);
		if (Option.isNone(taskOpt)) {
			return yield* Effect.fail(new Error(`No TDD task found for id ${input.tddTaskId}.`));
		}
		if (taskOpt.value.endedAt !== null) {
			return yield* Effect.fail(
				new Error(`TDD task ${input.tddTaskId} has already ended (endedAt=${taskOpt.value.endedAt}).`),
			);
		}

		return yield* writeArtifactUnderOpenPhase(input.tddTaskId, input);
	});

/**
 * Input for {@link dispatchRecordTddArtifactEffect}: the union of the chat-id
 * and task-id recording shapes, with `tddTaskId` taking priority.
 *
 * @public
 */
export interface DispatchRecordTddArtifactInput {
	/** Host chat id to resolve the open TDD task from (used when `tddTaskId` is absent). */
	readonly chatId?: string;
	/** Explicit `tdd_tasks.id`; takes priority over `chatId`. */
	readonly tddTaskId?: number;
	/** Kind of evidence being recorded. */
	readonly artifactKind: ArtifactKind;
	/** `files.id` the artifact refers to, when file-scoped. */
	readonly fileId?: number;
	/** `test_cases.id` the artifact refers to, when test-scoped. */
	readonly testCaseId?: number;
	/** `test_runs.id` that produced the evidence. */
	readonly testRunId?: number;
	/** Run id of the first observed failure for a red-phase artifact. */
	readonly testFirstFailureRunId?: number;
	/** Short diff excerpt attached to the artifact. */
	readonly diffExcerpt?: string;
	/** ISO-8601 timestamp of the artifact. */
	readonly recordedAt: string;
	/** Ambient input (see `RecordTddArtifactInput.cwd`); only consulted on the `chatId` branch. */
	readonly cwd: string;
	/** Project name for bootstrapped session rows; only consulted on the `chatId` branch. */
	readonly project?: string;
	/** Issue #363: explicit suite marker. Defaults to `"vitest"` when omitted. */
	readonly suite?: ArtifactSuite;
}

/**
 * CLI-command-facing dispatcher (issue #144). Keeps `commands/record.ts`
 * a thin flag-parsing wrapper per this package's convention. `tddTaskId`
 * takes priority when both are supplied — it is the explicit escape
 * hatch and should never silently fall back to (weaker) session
 * resolution.
 *
 * @param input - the artifact plus either a chat id or a TDD task id
 * @public
 */
export const dispatchRecordTddArtifactEffect = (
	input: DispatchRecordTddArtifactInput,
): Effect.Effect<RecordTddArtifactResult, DataStoreError | Error, DataReader | DataStore | FileSystem.FileSystem> => {
	if (input.tddTaskId !== undefined) {
		return recordTddArtifactByTaskIdEffect({
			tddTaskId: input.tddTaskId,
			artifactKind: input.artifactKind,
			...(input.fileId !== undefined && { fileId: input.fileId }),
			...(input.testCaseId !== undefined && { testCaseId: input.testCaseId }),
			...(input.testRunId !== undefined && { testRunId: input.testRunId }),
			...(input.testFirstFailureRunId !== undefined && {
				testFirstFailureRunId: input.testFirstFailureRunId,
			}),
			...(input.diffExcerpt !== undefined && { diffExcerpt: input.diffExcerpt }),
			...(input.suite !== undefined && { suite: input.suite }),
			recordedAt: input.recordedAt,
		});
	}
	if (input.chatId !== undefined) {
		return recordTddArtifactEffect({
			chatId: input.chatId,
			artifactKind: input.artifactKind,
			...(input.fileId !== undefined && { fileId: input.fileId }),
			...(input.testCaseId !== undefined && { testCaseId: input.testCaseId }),
			...(input.testRunId !== undefined && { testRunId: input.testRunId }),
			...(input.testFirstFailureRunId !== undefined && {
				testFirstFailureRunId: input.testFirstFailureRunId,
			}),
			...(input.diffExcerpt !== undefined && { diffExcerpt: input.diffExcerpt }),
			...(input.suite !== undefined && { suite: input.suite }),
			recordedAt: input.recordedAt,
			cwd: input.cwd,
			...(input.project !== undefined && { project: input.project }),
		});
	}
	return Effect.fail(new Error("record tdd-artifact requires either --chat-id or --tdd-task-id."));
};
