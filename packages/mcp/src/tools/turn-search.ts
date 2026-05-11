/**
 * `turn_search` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { Effect, ParseResult, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const TurnRow = Schema.Struct({
	id: Schema.Number.annotations({ description: "Numeric primary key of this turn row." }),
	sessionId: Schema.Number.annotations({ description: "Owning `sessions.id` (integer FK)." }),
	turnNo: Schema.Number.annotations({ description: "Turn ordinal within the session (1-based)." }),
	type: Schema.String.annotations({
		description:
			"Turn category (`user_prompt`, `tool_call`, `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`).",
	}),
	payload: Schema.String.annotations({
		description: "Type-specific payload as a JSON-encoded string. Decode shape depends on `type`.",
	}),
	occurredAt: Schema.String.annotations({ description: "ISO-8601 timestamp the turn was recorded at." }),
}).annotations({ identifier: "TurnRow", description: "One row from the turns log." });

export const TurnSearchResult = Schema.Struct({
	count: Schema.Number.annotations({ description: "Number of matching turn rows returned." }),
	turns: Schema.Array(TurnRow).annotations({ description: "Matching turns ordered by `occurredAt` ascending." }),
}).annotations({
	identifier: "TurnSearchResult",
	title: "turn_search result",
	description: "Turn-log search results across all sessions, optionally filtered by session, time, type.",
});
export type TurnSearchResultType = Schema.Schema.Type<typeof TurnSearchResult>;

export const formatTurnSearchMarkdown = (data: TurnSearchResultType): string => {
	if (data.turns.length === 0) return "No turns matched.";
	const lines: string[] = ["# Turns", ""];
	for (const t of data.turns) {
		lines.push(`- session=${t.sessionId} turn=${t.turnNo} type=${t.type} at=${t.occurredAt}`);
	}
	return lines.join("\n");
};

export const TurnSearchAsMarkdown = Schema.transformOrFail(TurnSearchResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatTurnSearchMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(
			new ParseResult.Forbidden(
				ast,
				text,
				"TurnSearchAsMarkdown is one-way: markdown cannot be parsed back to TurnSearchResult.",
			),
		),
});

export const turnSearch = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				sessionId: Schema.optional(Schema.Number),
				since: Schema.optional(Schema.String),
				type: Schema.optional(
					Schema.Literal("user_prompt", "tool_call", "tool_result", "file_edit", "hook_fire", "note", "hypothesis"),
				),
				limit: Schema.optional(Schema.Number),
			}),
		),
	)
	.query(
		async ({ ctx, input }): Promise<TurnSearchResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const rows = yield* reader.searchTurns({
						...(input.sessionId !== undefined && { sessionId: input.sessionId }),
						...(input.since !== undefined && { since: input.since }),
						...(input.type !== undefined && { type: input.type }),
						limit: input.limit ?? 100,
					});
					return { count: rows.length, turns: rows };
				}),
			),
	);
