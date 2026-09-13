// Shared session-resolution helper for hook-driven recording paths.
//
// Background: Claude Code can rotate the chat id (host `session_id`)
// mid-window — after a continuation, compaction, or `/mcp` reconnect —
// without the `SessionStart` hook firing for the new id. PostToolUse
// hooks then deliver tool calls under a `chat_id` that has no row in
// `sessions`, and the strict `getSessionByChatId` lookup fails with
// "Unknown chat_id". A second flavour of the same bug: the
// SubagentStart hook mints a synthetic per-dispatch key
// (`<parentChatId>-subagent-<ts>-<pid>`) for the subagent row, but
// subsequent PostToolUse hooks under that subagent receive the bare
// parent chat id. Exact-match lookup of the bare id misses the
// synthetic suffix.
//
// This resolver applies a three-step fallback that recovers either
// case without crashing the recording path:
//
//   1. Exact match by `chat_id`.
//   2. Prefix match `<chatId>-subagent-` to recover the synthetic
//      subagent row (most recent first).
//   3. Idempotent bootstrap of a `main` session row keyed on the
//      input `chat_id`, so future calls in this window resolve via
//      step 1.
//
// Step 3 means recording paths can no longer fail with "Unknown
// chat_id". Bootstrapped rows carry `agent_kind = "main"` and
// `triage_was_non_empty = false` because the SessionStart triage
// pipeline never ran for them; downstream metrics consumers should
// treat triage-empty bootstrapped rows the same as any other
// SessionStart-less row.

import type { DataStoreError } from "@vitest-agent/sdk";
import { Effect, FileSystem, Option } from "effect";
import type { SessionDetail } from "../services/DataReader.js";
import { DataReader } from "../services/DataReader.js";
import { DataStore } from "../services/DataStore.js";

/**
 * Input for {@link resolveSessionForRecording}.
 *
 * @public
 */
export interface ResolveSessionForRecordingInput {
	/** Host chat id to resolve. */
	readonly chatId: string;
	/** ISO-8601 timestamp used as `started_at` for a bootstrapped row. */
	readonly recordedAt: string;
	/**
	 * Project name for the bootstrapped row. Defaults to
	 * `package.json#name` in `cwd`, then `"unknown"`.
	 */
	readonly project?: string;
	/**
	 * Working directory for the bootstrapped row and the `package.json`
	 * probe. Ambient input: the caller (a CLI command) passes its own
	 * `process.cwd()`; the engine never reads `process` itself.
	 */
	readonly cwd: string;
}

/**
 * Resolve the `sessions` row for a hook-delivered chat id: exact match,
 * then the synthetic `-subagent-` prefix, then an idempotent bootstrap of
 * a `main` row so recording never fails with "Unknown chat_id".
 *
 * @param input - the chat id and ambient bootstrap inputs
 * @returns the resolved (or newly created) session row
 * @public
 */
export const resolveSessionForRecording = (
	input: ResolveSessionForRecordingInput,
): Effect.Effect<SessionDetail, DataStoreError, DataReader | DataStore | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const store = yield* DataStore;
		const fs = yield* FileSystem.FileSystem;

		const exact = yield* reader.getSessionByChatId(input.chatId);
		if (Option.isSome(exact)) return exact.value;

		const synthetic = yield* reader.findSessionsByChatPrefix(`${input.chatId}-subagent-`);
		if (synthetic.length > 0) return synthetic[0];

		const cwd = input.cwd;
		const project = input.project ?? (yield* readPackageName(fs, cwd)) ?? "unknown";
		yield* store.upsertSession({
			chatId: input.chatId,
			project,
			cwd,
			agentKind: "main",
			triageWasNonEmpty: false,
			startedAt: input.recordedAt,
		});
		const created = yield* reader.getSessionByChatId(input.chatId);
		return Option.getOrThrowWith(
			created,
			() => new Error(`upsertSession succeeded but row not found for ${input.chatId}`),
		);
	});

/**
 * Best-effort `package.json#name` read through the injected `FileSystem`.
 * Any read or parse failure resolves to `undefined` — the caller falls
 * back to `"unknown"`, exactly as the former sync `readFileSync` probe did.
 */
const readPackageName = (fs: FileSystem.FileSystem, cwd: string): Effect.Effect<string | undefined> =>
	fs.readFileString(`${cwd}/package.json`).pipe(
		Effect.flatMap((raw) => Effect.try(() => JSON.parse(raw) as { name?: unknown })),
		Effect.map((parsed) => (typeof parsed.name === "string" ? parsed.name : undefined)),
		Effect.catch(() => Effect.succeed(undefined)),
	);
