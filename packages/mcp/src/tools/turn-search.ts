// `turn_search` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const TurnRow = Schema.Struct({
	id: Schema.Finite.annotate({ description: "Numeric primary key of this turn row." }),
	sessionId: Schema.Finite.annotate({ description: "Owning `sessions.id` (integer FK)." }),
	turnNo: Schema.Finite.annotate({ description: "Turn ordinal within the session (1-based)." }),
	type: Schema.String.annotate({
		description:
			"Turn category (`user_prompt`, `tool_call`, `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`).",
	}),
	payload: Schema.String.annotate({
		description: "Type-specific payload as a JSON-encoded string. Decode shape depends on `type`.",
	}),
	occurredAt: Schema.String.annotate({ description: "ISO-8601 timestamp the turn was recorded at." }),
}).annotate({ identifier: "TurnRow", description: "One row from the turns log." });

/**
 * The `turn_search` tool's success payload.
 *
 * @public
 */
export const TurnSearchResult = Schema.Struct({
	count: Schema.Finite.annotate({ description: "Number of matching turn rows returned." }),
	turns: Schema.Array(TurnRow).annotate({ description: "Matching turns ordered by `occurredAt` ascending." }),
}).annotate({
	identifier: "TurnSearchResult",
	title: "turn_search result",
	description: "Turn-log search results across all sessions, optionally filtered by session, time, type.",
});
/**
 * The decoded {@link TurnSearchResult}.
 *
 * @public
 */
export type TurnSearchResultType = Schema.Schema.Type<typeof TurnSearchResult>;

export const formatTurnSearchMarkdown = (data: TurnSearchResultType): string => {
	if (data.turns.length === 0) return "No turns matched.";
	const lines: string[] = ["# Turns", ""];
	for (const t of data.turns) {
		lines.push(`- session=${t.sessionId} turn=${t.turnNo} type=${t.type} at=${t.occurredAt}`);
	}
	return lines.join("\n");
};

export const TurnSearchAsMarkdown = TurnSearchResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTurnSearchMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "TurnSearchAsMarkdown is one-way: markdown cannot be parsed back to TurnSearchResult.",
		),
	}),
);

/**
 * The `turn_search` tool's parameters.
 *
 * @public
 */
export const TurnSearchInput = Schema.Struct({
	sessionId: Schema.optionalKey(Schema.Finite).annotate({ description: "Filter to a specific session id" }),
	since: Schema.optionalKey(Schema.String).annotate({
		description: "ISO 8601 cutoff — return turns after this timestamp",
	}),
	type: Schema.optionalKey(
		Schema.Literals(["user_prompt", "tool_call", "tool_result", "file_edit", "hook_fire", "note", "hypothesis"]),
	).annotate({ description: "Filter by turn type" }),
	limit: Schema.optionalKey(Schema.Finite).annotate({ description: "Max turns to return (default 100)" }),
});
/**
 * The decoded {@link TurnSearchInput}.
 *
 * @public
 */
export type TurnSearchInputType = Schema.Schema.Type<typeof TurnSearchInput>;

/**
 * Handler for {@link turnSearchTool}.
 *
 * @public
 */
export const handleTurnSearch = (input: TurnSearchInputType): Effect.Effect<TurnSearchResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const rows = yield* reader.searchTurns({
			...(input.sessionId !== undefined && { sessionId: input.sessionId }),
			...(input.since !== undefined && { since: input.since }),
			...(input.type !== undefined && { type: input.type }),
			limit: input.limit ?? 100,
		});
		return { count: rows.length, turns: rows };
	}).pipe(Effect.orDie);

/**
 * The Effect-native `turn_search` tool.
 *
 * @public
 */
export const turnSearchTool = Tool.make("turn_search", {
	description:
		"Use when you need to find past turns across sessions by type, time, or session. Returns markdown in content[] and a typed JSON object in structuredContent ({ count, turns[] }).",
	parameters: TurnSearchInput,
	success: TurnSearchResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Turn search")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatTurnSearchMarkdown(encoded as TurnSearchResultType));
