/**
 * `turn_search` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const TurnRow = Schema.Struct({
	id: Schema.Number.annotate({ description: "Numeric primary key of this turn row." }),
	sessionId: Schema.Number.annotate({ description: "Owning `sessions.id` (integer FK)." }),
	turnNo: Schema.Number.annotate({ description: "Turn ordinal within the session (1-based)." }),
	type: Schema.String.annotate({
		description:
			"Turn category (`user_prompt`, `tool_call`, `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`).",
	}),
	payload: Schema.String.annotate({
		description: "Type-specific payload as a JSON-encoded string. Decode shape depends on `type`.",
	}),
	occurredAt: Schema.String.annotate({ description: "ISO-8601 timestamp the turn was recorded at." }),
}).annotate({ identifier: "TurnRow", description: "One row from the turns log." });

export const TurnSearchResult = Schema.Struct({
	count: Schema.Number.annotate({ description: "Number of matching turn rows returned." }),
	turns: Schema.Array(TurnRow).annotate({ description: "Matching turns ordered by `occurredAt` ascending." }),
}).annotate({
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

export const TurnSearchAsMarkdown = TurnSearchResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTurnSearchMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "TurnSearchAsMarkdown is one-way: markdown cannot be parsed back to TurnSearchResult.",
		),
	}),
);

export const turnSearch = publicProcedure
	.input(
		Schema.toStandardSchemaV1(
			Schema.Struct({
				sessionId: Schema.optional(Schema.Number),
				since: Schema.optional(Schema.String),
				type: Schema.optional(
					Schema.Literals(["user_prompt", "tool_call", "tool_result", "file_edit", "hook_fire", "note", "hypothesis"]),
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
