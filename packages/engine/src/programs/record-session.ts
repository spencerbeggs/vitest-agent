import { Effect } from "effect";
import { DataReader } from "../services/DataReader.js";
import { DataStore } from "../services/DataStore.js";

/**
 * Input for {@link recordSessionStart}: the identity of the session row to upsert.
 *
 * @public
 */
export interface RecordSessionStartInput {
	/** Host chat id (Claude Code `session_id`) keying the `sessions` row. */
	readonly chatId: string;
	/** Project name the session runs under. */
	readonly project: string;
	/** Working directory of the session. */
	readonly cwd: string;
	/** Whether this is the main agent or a dispatched subagent. */
	readonly agentKind: "main" | "subagent";
	/** Subagent type name, when `agentKind` is `"subagent"`. */
	readonly agentType?: string;
	/** Chat id of the parent session, used to link subagent rows to their parent. */
	readonly parentChatId?: string;
	/** Whether the SessionStart triage brief had content. */
	readonly triageWasNonEmpty: boolean;
	/** ISO-8601 start timestamp. */
	readonly startedAt: string;
}

/**
 * Upsert a `sessions` row for a SessionStart / SubagentStart hook, resolving
 * `parentChatId` to the parent's numeric session id when present.
 *
 * @param input - the session identity to record
 * @returns the numeric `sessions.id`
 * @public
 */
export const recordSessionStart = (
	input: RecordSessionStartInput,
): Effect.Effect<{ sessionId: number }, Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const store = yield* DataStore;

		let parentSessionId: number | undefined;
		if (input.parentChatId !== undefined) {
			const parent = yield* reader.getSessionByChatId(input.parentChatId);
			if (parent._tag === "Some") {
				parentSessionId = parent.value.id;
			}
		}

		const sessionId = yield* store.upsertSession({
			chatId: input.chatId,
			project: input.project,
			cwd: input.cwd,
			agentKind: input.agentKind,
			...(input.agentType !== undefined && { agentType: input.agentType }),
			...(parentSessionId !== undefined && { parentSessionId }),
			triageWasNonEmpty: input.triageWasNonEmpty,
			startedAt: input.startedAt,
		});

		return { sessionId };
	});

/**
 * Input for {@link recordSessionEnd}: which session to close and why.
 *
 * @public
 */
export interface RecordSessionEndInput {
	/** Host chat id of the session to close. */
	readonly chatId: string;
	/** ISO-8601 end timestamp. */
	readonly endedAt: string;
	/** Claude Code's SessionEnd reason, or `null` when unknown. */
	readonly endReason: string | null;
}

/**
 * Close a `sessions` row for a SessionEnd hook. Fails with an `Error`
 * when no session exists for `chatId`.
 *
 * @param input - the session to close
 * @public
 */
export const recordSessionEnd = (
	input: RecordSessionEndInput,
): Effect.Effect<{ ok: true }, Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const store = yield* DataStore;
		const sessionOpt = yield* reader.getSessionByChatId(input.chatId);
		if (sessionOpt._tag === "None") {
			return yield* Effect.fail(new Error(`Unknown chatId: ${input.chatId}`));
		}
		yield* store.endSession(input.chatId, input.endedAt, input.endReason);
		return { ok: true };
	});
