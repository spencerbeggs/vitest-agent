/**
 * Lib function for the `record tdd-artifact` CLI subcommand.
 *
 * Per Decision D7, artifact writes go through the CLI (driven by
 * PostToolUse hooks) -- never through MCP. The hook supplies the
 * host chat id; this lib resolves the active TDD phase for that
 * session and writes the artifact under it.
 *
 * @packageDocumentation
 */

import type { ArtifactKind, DataStoreError } from "@vitest-agent/sdk";
import { DataReader, DataStore } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";
import { resolveSessionForRecording } from "./resolve-session-for-recording.js";

export interface RecordTddArtifactInput {
	readonly chatId: string;
	readonly artifactKind: ArtifactKind;
	readonly fileId?: number;
	readonly testCaseId?: number;
	readonly testRunId?: number;
	readonly testFirstFailureRunId?: number;
	readonly diffExcerpt?: string;
	readonly recordedAt: string;
	/**
	 * Working directory of the calling process. When omitted, the
	 * resolver falls back to `process.cwd()`. Used to bootstrap a
	 * missing session row when the chat id has no exact match.
	 */
	readonly cwd?: string;
	/**
	 * Project name for bootstrapped session rows. When omitted, the
	 * resolver reads `package.json#name` from `cwd`.
	 */
	readonly project?: string;
}

export interface RecordTddArtifactResult {
	readonly id: number;
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
		"artifactKind" | "fileId" | "testCaseId" | "testRunId" | "testFirstFailureRunId" | "diffExcerpt" | "recordedAt"
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
			recordedAt: input.recordedAt,
		});

		return { id, phaseId };
	});

export const recordTddArtifactEffect = (
	input: RecordTddArtifactInput,
): Effect.Effect<RecordTddArtifactResult, DataStoreError | Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const session = yield* resolveSessionForRecording({
			chatId: input.chatId,
			recordedAt: input.recordedAt,
			...(input.project !== undefined && { project: input.project }),
			...(input.cwd !== undefined && { cwd: input.cwd }),
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

export interface RecordTddArtifactByTaskIdInput {
	readonly tddTaskId: number;
	readonly artifactKind: ArtifactKind;
	readonly fileId?: number;
	readonly testCaseId?: number;
	readonly testRunId?: number;
	readonly testFirstFailureRunId?: number;
	readonly diffExcerpt?: string;
	readonly recordedAt: string;
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
