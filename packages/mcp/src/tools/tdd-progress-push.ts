// `tdd_progress_push` MCP tool: a TDD orchestrator reports progress to the
// main agent. The payload is validated against the `ChannelEvent` union,
// enriched server-side with the tree coordinates a stale orchestrator
// context cannot be trusted to supply, and published as an MCP
// `notifications/message` (logger `vitest-agent/channel`). Best-effort:
// the tool returns `{ ok: true }` whether or not a client received it.

import { DataReader } from "@vitest-agent/engine";
import { ChannelEvent } from "@vitest-agent/sdk";
import { Effect, Option, Schema } from "effect";
import { McpServer, Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

/**
 * The `tdd_progress_push` tool's parameters.
 *
 * @public
 */
export const TddProgressPushInput = Schema.Struct({
	payload: Schema.String.annotate({
		description: "Pre-stringified ChannelEvent JSON (see schemas/ChannelEvent in @vitest-agent/sdk)",
	}),
});
/**
 * The decoded {@link TddProgressPushInput}.
 *
 * @public
 */
export type TddProgressPushInputType = Schema.Schema.Type<typeof TddProgressPushInput>;

/**
 * The `tdd_progress_push` result — always `{ ok: true }`.
 *
 * @public
 */
export const TddProgressPushResult = Schema.Struct({ ok: Schema.Literal(true) }).annotate({
	identifier: "TddProgressPushResult",
	title: "tdd_progress_push result",
	description: "Always ok:true — the push is best-effort and never reports delivery.",
});
/**
 * The decoded {@link TddProgressPushResult}.
 *
 * @public
 */
export type TddProgressPushResultType = Schema.Schema.Type<typeof TddProgressPushResult>;

/** The logger name every channel notification is published under. */
export const CHANNEL_LOGGER = "vitest-agent/channel";

/**
 * For behavior-scoped events, resolve goalId/sessionId server-side from
 * behaviorId so a stale orchestrator context cannot push the wrong tree
 * coordinates. Goal-scoped events get sessionId resolved from goalId.
 * Returns the enriched event object or the original on resolution failure.
 *
 * @internal
 */
export const resolveChannelEvent = (raw: unknown): Effect.Effect<unknown, never, DataReader> =>
	Effect.gen(function* () {
		const decoded = yield* Schema.decodeUnknownEffect(ChannelEvent)(raw).pipe(Effect.option);
		if (Option.isNone(decoded)) {
			// Pass through invalid payloads — channel push is best-effort and
			// we don't want to break the orchestrator if a future event type
			// has not been added to the schema yet. The receiving main agent
			// will still parse the JSON and apply its own handler.
			return raw;
		}
		const event = decoded.value;
		const reader = yield* DataReader;
		return yield* Effect.gen(function* () {
			switch (event.type) {
				case "behavior_started":
				case "phase_transition":
				case "behavior_completed":
				case "behavior_abandoned":
				case "blocked": {
					const goalIdOpt = yield* reader.resolveGoalIdForBehavior(event.behaviorId);
					if (Option.isNone(goalIdOpt)) return event;
					const goalDetailOpt = yield* reader.getGoalById(goalIdOpt.value);
					if (Option.isNone(goalDetailOpt)) return event;
					return { ...event, goalId: goalIdOpt.value, sessionId: goalDetailOpt.value.sessionId };
				}
				case "goal_started":
				case "goal_completed":
				case "goal_abandoned": {
					const goalDetailOpt = yield* reader.getGoalById(event.goalId);
					if (Option.isNone(goalDetailOpt)) return event;
					return { ...event, sessionId: goalDetailOpt.value.sessionId };
				}
				default:
					return event;
			}
		}).pipe(Effect.orElseSucceed((): unknown => event));
	});

/**
 * Handler for {@link tddProgressPushTool}. Malformed JSON is forwarded as
 * the raw string; a DB read failure forwards the decoded event unenriched;
 * a notification failure (no initialized client, transport gone) is
 * ignored. The result is `{ ok: true }` on every path.
 *
 * @public
 */
export const handleTddProgressPush = (
	input: TddProgressPushInputType,
): Effect.Effect<TddProgressPushResultType, never, DataReader | McpServer.McpServer> =>
	Effect.gen(function* () {
		const server = yield* McpServer.McpServer;
		const parsed = yield* Effect.try(() => JSON.parse(input.payload) as unknown).pipe(Effect.option);
		const data: unknown = Option.isSome(parsed) ? yield* resolveChannelEvent(parsed.value) : input.payload;
		yield* server.notifications["notifications/message"]({ level: "info", logger: CHANNEL_LOGGER, data }).pipe(
			Effect.ignore,
		);
		return { ok: true as const };
	});

/**
 * The Effect-native `tdd_progress_push` tool.
 *
 * @public
 */
export const tddProgressPushTool = Tool.make("tdd_progress_push", {
	description:
		"Use when a TDD orchestrator needs to report progress to the main agent over a Claude Code channel. The MCP server validates the payload against the ChannelEvent union and resolves goalId/sessionId server-side from behaviorId for behavior-scoped events (so a stale orchestrator context cannot push the wrong tree coordinates). Best-effort — returns { ok: true } regardless of whether channels are active.",
	parameters: TddProgressPushInput,
	success: TddProgressPushResult,
	dependencies: [DataReader, McpServer.McpServer],
})
	.annotate(Tool.Title, "TDD progress push")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, false)
	.annotate(RenderText, (encoded) => JSON.stringify(encoded, null, 2));
