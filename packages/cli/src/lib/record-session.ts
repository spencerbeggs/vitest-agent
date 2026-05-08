import { Effect } from "effect";
import { DataReader, DataStore } from "vitest-agent-sdk";

export interface RecordSessionStartInput {
	readonly ccSessionId: string;
	readonly project: string;
	readonly cwd: string;
	readonly agentKind: "main" | "subagent";
	readonly agentType?: string;
	readonly parentCcSessionId?: string;
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
		if (input.parentCcSessionId !== undefined) {
			const parent = yield* reader.getSessionByCcId(input.parentCcSessionId);
			if (parent._tag === "Some") {
				parentSessionId = parent.value.id;
			}
		}

		const sessionId = yield* store.writeSession({
			cc_session_id: input.ccSessionId,
			project: input.project,
			cwd: input.cwd,
			agent_kind: input.agentKind,
			...(input.agentType !== undefined && { agent_type: input.agentType }),
			...(parentSessionId !== undefined && { parent_session_id: parentSessionId }),
			triage_was_non_empty: input.triageWasNonEmpty,
			started_at: input.startedAt,
		});

		return { sessionId };
	});

export interface RecordSessionEndInput {
	readonly ccSessionId: string;
	readonly endedAt: string;
	readonly endReason: string | null;
}

export const recordSessionEnd = (
	input: RecordSessionEndInput,
): Effect.Effect<{ ok: true }, Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const store = yield* DataStore;
		const sessionOpt = yield* reader.getSessionByCcId(input.ccSessionId);
		if (sessionOpt._tag === "None") {
			return yield* Effect.fail(new Error(`Unknown cc_session_id: ${input.ccSessionId}`));
		}
		yield* store.endSession(input.ccSessionId, input.endedAt, input.endReason);
		return { ok: true };
	});
