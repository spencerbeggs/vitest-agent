import type { DataReader } from "@vitest-agent/sdk";
import { DataStore, TurnPayload } from "@vitest-agent/sdk";
import { Effect, Schema } from "effect";
import { resolveSessionForRecording } from "./resolve-session-for-recording.js";

export type ParseResult = { ok: true; payload: typeof TurnPayload.Type } | { ok: false; error: string };

export const parseAndValidateTurnPayload = (raw: string): ParseResult => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
	}
	const decoded = Schema.decodeUnknownResult(TurnPayload)(parsed);
	if (decoded._tag === "Failure") {
		return { ok: false, error: `Invalid TurnPayload: ${decoded.failure.message}` };
	}
	return { ok: true, payload: decoded.success };
};

export interface RecordTurnInput {
	readonly chatId: string;
	readonly payloadJson: string;
	readonly occurredAt: string;
	/**
	 * Working directory of the calling process. When omitted, the
	 * resolver falls back to `process.cwd()`. Used to bootstrap a
	 * session row when no exact `chat_id` match exists, which happens
	 * after Claude Code rotates the chat id mid-window without
	 * `SessionStart` re-firing for the new id.
	 */
	readonly cwd?: string;
	/**
	 * Project name for bootstrapped session rows. When omitted, the
	 * resolver reads `package.json#name` from `cwd`, falling back to
	 * `"unknown"`.
	 */
	readonly project?: string;
}

export const recordTurnEffect = (
	input: RecordTurnInput,
): Effect.Effect<{ turnId: number }, Error, DataReader | DataStore> =>
	Effect.gen(function* () {
		const parse = parseAndValidateTurnPayload(input.payloadJson);
		if (!parse.ok) {
			return yield* Effect.fail(new Error(parse.error));
		}
		const session = yield* resolveSessionForRecording({
			chatId: input.chatId,
			recordedAt: input.occurredAt,
			...(input.project !== undefined && { project: input.project }),
			...(input.cwd !== undefined && { cwd: input.cwd }),
		});
		const store = yield* DataStore;
		const turnId = yield* store.writeTurn({
			sessionId: session.id,
			type: parse.payload.type,
			payload: input.payloadJson,
			occurredAt: input.occurredAt,
		});
		return { turnId };
	});
