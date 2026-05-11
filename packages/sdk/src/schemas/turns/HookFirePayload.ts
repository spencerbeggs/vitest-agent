import { Schema } from "effect";

export const HookFirePayload = Schema.Struct({
	type: Schema.Literal("hook_fire"),
	hook_kind: Schema.Literal(
		"SessionStart",
		"SessionEnd",
		"Stop",
		"StopFailure",
		"SubagentStart",
		"SubagentStop",
		"PreCompact",
		"PostCompact",
		"PreToolUse",
		"PostToolUse",
		"PostToolUseFailure",
		"UserPromptSubmit",
		"FileChanged",
	),
	chat_id: Schema.optional(Schema.String),
	previous_record_failures: Schema.optional(Schema.Array(Schema.String)),
});

export type HookFirePayload = typeof HookFirePayload.Type;
