import { TurnPayload } from "@vitest-agent/sdk";
import type { FileSystem, Path } from "effect";
import { Effect, Result, Schema } from "effect";
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

// One codec: JSON parse + `TurnPayload` decode, so malformed text and a
// well-formed body of the wrong shape fail through the same channel.
const decodeTurnPayload = Schema.decodeUnknownResult(Schema.fromJsonString(TurnPayload));

/**
 * Parse a raw JSON string and validate it against the `TurnPayload` schema
 * without throwing.
 *
 * Text that is not JSON at all reads `Invalid JSON: …`; JSON whose body is
 * not a `TurnPayload` reads `Invalid TurnPayload: …`.
 *
 * @param raw - the JSON text delivered by the hook
 * @returns the decoded payload, or an error describing why it was rejected
 * @public
 */
export const parseAndValidateTurnPayload = (raw: string): ParseResult => {
	const decoded = decodeTurnPayload(raw);
	if (Result.isSuccess(decoded)) return { ok: true, payload: decoded.success };
	// `fromJsonString` reports text that does not parse as an `Encoding`
	// issue at the top; a parsed body of the wrong shape is a nested issue.
	const prefix = decoded.failure.issue._tag === "Encoding" ? "Invalid JSON" : "Invalid TurnPayload";
	return { ok: false, error: `${prefix}: ${decoded.failure.message}` };
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
): Effect.Effect<{ turnId: number }, Error, DataReader | DataStore | FileSystem.FileSystem | Path.Path> =>
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
