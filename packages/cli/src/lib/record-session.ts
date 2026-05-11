import { Effect } from "effect";
import { DataReader, DataStore } from "vitest-agent-sdk";

export interface RecordSessionStartInput {
	readonly chatId: string;
	readonly project: string;
	readonly cwd: string;
	readonly agentKind: "main" | "subagent";
	readonly agentType?: string;
	readonly parentChatId?: string;
	readonly triageWasNonEmpty: boolean;
	readonly startedAt: string;
}

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

export interface RecordSessionEndInput {
	readonly chatId: string;
	readonly endedAt: string;
	readonly endReason: string | null;
}

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
