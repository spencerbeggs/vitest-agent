// Idempotent replay for the four write tools: `@effected/mcp`'s `ToolReplay`
// over the engine's `mcp_idempotent_responses` table, through a
// `ToolReplayStore` (`get` / `set`). A replayed call returns the stored first result, marked
// `_idempotentReplay: true` (declared on each replayable success member via
// `IdempotentReplayMarker`, or the wire encoder would drop it).

import type { ToolReplayStore } from "@effected/mcp";
import { ToolReplay } from "@effected/mcp";
import { DataReader, DataStore } from "@vitest-agent/engine";
import type { Schema } from "effect";
import { Effect, Option } from "effect";
import type { HypothesisInputType } from "./tools/hypothesis.js";
import type { TddBehaviorInputType } from "./tools/tdd-behavior.js";
import type { TddGoalInputType } from "./tools/tdd-goal.js";
import type { TddTaskInputType } from "./tools/tdd-task.js";

/**
 * `hypothesis`: `validate` keys on `validate:<id>:<outcome>`. `record` is
 * deliberately NOT idempotent: a hypothesis is an append-only observation
 * whose binding session is resolved server-side (and so is absent from the
 * input), leaving no safe per-call discriminator — content-only keying would
 * collide across sessions and replay a stale row under the wrong one. A
 * genuine retry creating a duplicate hypothesis row is harmless by comparison.
 *
 * @internal
 */
export const hypothesisReplayKey = (input: HypothesisInputType): Option.Option<string> =>
	input.action === "validate" ? Option.some(`validate:${input.id}:${input.outcome}`) : Option.none();

/**
 * `tdd_task`: `start` keys on whichever id form is present (`sid:` for
 * `sessionId`, `chat:` for `chatId`, so a chat id can never collide with an
 * integer id) plus the `runId` when supplied, else the goal text — a new
 * `runId` lets the same goal be retried in one chat; `end` keys on
 * `end:<tddTaskId>:<outcome>`.
 *
 * @internal
 */
export const tddTaskReplayKey = (input: TddTaskInputType): Option.Option<string> => {
	if (input.action === "start") {
		const id =
			input.sessionId !== undefined
				? `sid:${input.sessionId}`
				: input.chatId !== undefined
					? `chat:${input.chatId}`
					: undefined;
		if (id === undefined) return Option.none();
		return Option.some(input.runId !== undefined ? `start:${id}:run:${input.runId}` : `start:${id}:${input.goal}`);
	}
	if (input.action === "end") return Option.some(`end:${input.tddTaskId}:${input.outcome}`);
	return Option.none();
};

/**
 * `tdd_goal`: `create` keys on `create:<tddTaskId>:<goal>`.
 *
 * @internal
 */
export const tddGoalReplayKey = (input: TddGoalInputType): Option.Option<string> =>
	input.action === "create" ? Option.some(`create:${input.tddTaskId}:${input.goal}`) : Option.none();

/**
 * `tdd_behavior`: `create` keys on `create:<goalId>:<behavior>`.
 *
 * @internal
 */
export const tddBehaviorReplayKey = (input: TddBehaviorInputType): Option.Option<string> =>
	input.action === "create" ? Option.some(`create:${input.goalId}:${input.behavior}`) : Option.none();

/**
 * Splits a `ToolReplay.storeKey` (`<tool>:<key>`) back into the table's
 * `(procedure_path, key)` pair, so rows written before `ToolReplay` keep
 * replaying under the same coordinates.
 */
const splitStoreKey = (storeKey: string): readonly [tool: string, key: string] => {
	const at = storeKey.indexOf(":");
	return [storeKey.slice(0, at), storeKey.slice(at + 1)];
};

/**
 * A `ToolReplayStore` over `mcp_idempotent_responses`. A store fault fails
 * the `get` / `set`, which `ToolReplay` treats as a miss or a skipped write.
 *
 * @internal
 */
export const makeReplayStore: Effect.Effect<ToolReplayStore, never, DataReader | DataStore> = Effect.gen(function* () {
	const reader = yield* DataReader;
	const store = yield* DataStore;
	return {
		get: (storeKey) => {
			const [tool, key] = splitStoreKey(storeKey);
			return reader.findIdempotentResponse(tool, key).pipe(Effect.map(Option.getOrUndefined));
		},
		set: (storeKey, value) => {
			const [tool, key] = splitStoreKey(storeKey);
			return store.recordIdempotentResponse({
				procedurePath: tool,
				key,
				resultJson: value,
				createdAt: new Date().toISOString(),
			});
		},
	};
});

/**
 * `ToolReplay.wrap` for one write tool, with the replay store built from the
 * handler's own `DataReader` / `DataStore`, so the wrapped handler requires
 * exactly what the bare one did.
 *
 * @internal
 */
export const replayed =
	<P, S extends Schema.Top>(options: {
		readonly tool: string;
		readonly success: S;
		readonly key: (params: P) => Option.Option<string>;
	}) =>
	<E, R>(
		handler: (params: P) => Effect.Effect<S["Type"], E, R>,
	): ((
		params: P,
	) => Effect.Effect<S["Type"], E, R | S["DecodingServices"] | S["EncodingServices"] | DataReader | DataStore>) =>
	(params) =>
		Effect.flatMap(makeReplayStore, (store) => ToolReplay.wrap({ ...options, store })(handler)(params));
