/**
 * `wrapup_prompt` MCP tool — Schema-driven implementation.
 *
 * Same envelope shape as `triage_brief`: thin wrapper around the
 * markdown rendering with a `hasContent` discriminant for the empty
 * case.
 *
 * @packageDocumentation
 */

import { Effect, Schema } from "effect";
import { formatWrapupEffect } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const WrapupPromptResult = Schema.Struct({
	hasContent: Schema.Boolean.annotations({
		description: "`false` when there is nothing to wrap up for the named session/kind.",
	}),
	kind: Schema.Literal("stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge").annotations({
		description: "Echo of the wrap-up kind that was rendered (defaulted to `session_end` when omitted).",
	}),
	markdown: Schema.String.annotations({ description: "Pre-rendered wrap-up markdown or the empty-state message." }),
}).annotations({
	identifier: "WrapupPromptResult",
	title: "wrapup_prompt result",
	description: "Wrap-up envelope. Branch on `hasContent` for the empty case; consume `markdown` for rendering.",
});
export type WrapupPromptResultType = Schema.Schema.Type<typeof WrapupPromptResult>;

export const wrapupPrompt = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				sessionId: Schema.optional(Schema.Number),
				chatId: Schema.optional(Schema.String),
				kind: Schema.optional(Schema.Literal("stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge")),
				userPromptHint: Schema.optional(Schema.String),
			}),
		),
	)
	.query(
		async ({ ctx, input }): Promise<WrapupPromptResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const kind = input.kind ?? "session_end";
					const md = yield* formatWrapupEffect({
						...(input.sessionId !== undefined && { sessionId: input.sessionId }),
						...(input.chatId !== undefined && { chatId: input.chatId }),
						kind,
						...(input.userPromptHint !== undefined && { userPromptHint: input.userPromptHint }),
					});
					return md.length > 0
						? { hasContent: true, kind, markdown: md }
						: { hasContent: false, kind, markdown: "Nothing to wrap up." };
				}),
			),
	);
