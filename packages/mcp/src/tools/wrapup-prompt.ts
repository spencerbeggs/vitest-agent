// `wrapup_prompt` MCP tool — Schema-driven implementation.
//
// Same envelope shape as `triage_brief`: thin wrapper around the
// markdown rendering with a `hasContent` discriminant for the empty
// case.

import { DataReader, formatWrapupEffect } from "@vitest-agent/engine";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

/**
 * The `wrapup_prompt` tool's success payload.
 *
 * @public
 */
export const WrapupPromptResult = Schema.Struct({
	hasContent: Schema.Boolean.annotate({
		description: "`false` when there is nothing to wrap up for the named session/kind.",
	}),
	kind: Schema.Literals(["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]).annotate({
		description: "Echo of the wrap-up kind that was rendered (defaulted to `session_end` when omitted).",
	}),
	markdown: Schema.String.annotate({ description: "Pre-rendered wrap-up markdown or the empty-state message." }),
}).annotate({
	identifier: "WrapupPromptResult",
	title: "wrapup_prompt result",
	description: "Wrap-up envelope. Branch on `hasContent` for the empty case; consume `markdown` for rendering.",
});
/**
 * The decoded {@link WrapupPromptResult}.
 *
 * @public
 */
export type WrapupPromptResultType = Schema.Schema.Type<typeof WrapupPromptResult>;

/**
 * The `wrapup_prompt` tool's parameters.
 *
 * @public
 */
export const WrapupPromptInput = Schema.Struct({
	sessionId: Schema.optionalKey(Schema.Finite).annotate({ description: "sessions.id (integer); omit to use chatId" }),
	chatId: Schema.optionalKey(Schema.String).annotate({ description: "Host chat UUID (alternative to sessionId)" }),
	kind: Schema.optionalKey(
		Schema.Literals(["stop", "session_end", "pre_compact", "tdd_handoff", "user_prompt_nudge"]),
	).annotate({ description: "Wrap-up flavor (default: session_end)" }),
	userPromptHint: Schema.optionalKey(Schema.String).annotate({
		description: "For user_prompt_nudge: the prompt text to inspect",
	}),
});
/**
 * The decoded {@link WrapupPromptInput}.
 *
 * @public
 */
export type WrapupPromptInputType = Schema.Schema.Type<typeof WrapupPromptInput>;

/**
 * Handler for {@link wrapupPromptTool}.
 *
 * @public
 */
export const handleWrapupPrompt = (
	input: WrapupPromptInputType,
): Effect.Effect<WrapupPromptResultType, never, DataReader> =>
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
	});

/**
 * The Effect-native `wrapup_prompt` tool. The text channel is the
 * pre-rendered `markdown` field itself.
 *
 * @public
 */
export const wrapupPromptTool = Tool.make("wrapup_prompt", {
	description:
		"Use when a session is ending and you need a tailored wrap-up prompt (Stop / SessionEnd / PreCompact / TDD handoff / UserPromptSubmit nudge variants). Returns markdown in content[] and a typed envelope in structuredContent ({ hasContent, kind, markdown }).",
	parameters: WrapupPromptInput,
	success: WrapupPromptResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Wrap-up prompt")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => (encoded as WrapupPromptResultType).markdown);
