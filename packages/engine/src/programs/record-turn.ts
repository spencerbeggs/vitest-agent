import { TurnPayload } from "@vitest-agent/sdk";
import type { FileSystem } from "effect";
import { Effect, Schema } from "effect";
import type { DataReader } from "../services/DataReader.js";
import { DataStore } from "../services/DataStore.js";
import { resolveSessionForRecording } from "./resolve-session-for-recording.js";

/**
 * Outcome of {@link parseAndValidateTurnPayload}: the decoded `TurnPayload`
 * on success, or a human-readable error string.
 *
 * @public
 */
export type ParseResult = { ok: true; payload: typeof TurnPayload.Type } | { ok: false; error: string };

/**
 * Parse a raw JSON string and validate it against the `TurnPayload` schema
 * without throwing.
 *
 * @param raw - the JSON text delivered by the hook
 * @returns the decoded payload, or an error describing why it was rejected
 * @public
 */
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

/**
 * Input for {@link recordTurnEffect}: a turn payload keyed by host chat id.
 *
 * @public
 */
export interface RecordTurnInput {
	/** Host chat id whose session receives the turn. */
	readonly chatId: string;
	/** Raw JSON text of the `TurnPayload`; stored verbatim after validation. */
	readonly payloadJson: string;
	/** ISO-8601 timestamp of the turn. */
	readonly occurredAt: string;
	/**
	 * Working directory of the calling process (ambient input — the CLI
	 * command passes its own `process.cwd()` when no `--cwd` flag was
	 * given). Used to bootstrap a session row when no exact `chat_id`
	 * match exists, which happens after Claude Code rotates the chat id
	 * mid-window without `SessionStart` re-firing for the new id.
	 */
	readonly cwd: string;
	/**
	 * Project name for bootstrapped session rows. When omitted, the
	 * resolver reads `package.json#name` from `cwd`, falling back to
	 * `"unknown"`.
	 */
	readonly project?: string;
}

/**
 * Validate a turn payload and write it as a `turns` row under the session
 * resolved for `chatId` (bootstrapping the session row when needed).
 *
 * @param input - the turn to record
 * @returns the new `turns.id`
 * @public
 */
export const recordTurnEffect = (
	input: RecordTurnInput,
): Effect.Effect<{ turnId: number }, Error, DataReader | DataStore | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const parse = parseAndValidateTurnPayload(input.payloadJson);
		if (!parse.ok) {
			return yield* Effect.fail(new Error(parse.error));
		}
		const session = yield* resolveSessionForRecording({
			chatId: input.chatId,
			recordedAt: input.occurredAt,
			...(input.project !== undefined && { project: input.project }),
			cwd: input.cwd,
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
