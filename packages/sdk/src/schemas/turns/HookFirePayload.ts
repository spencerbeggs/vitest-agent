import { Schema } from "effect";
/** @public */
export const HookFirePayload = Schema.Struct({
	type: Schema.Literal("hook_fire"),
	hook_kind: Schema.Literals([
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
	]),
	chat_id: Schema.optional(Schema.String),
	previous_record_failures: Schema.optional(Schema.Array(Schema.String)),
});

/** @public */
export type HookFirePayload = typeof HookFirePayload.Type;
