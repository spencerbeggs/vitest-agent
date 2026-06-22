import { Schema } from "effect";
/** @public */
export const UserPromptPayload = Schema.Struct({
	type: Schema.Literal("user_prompt"),
	prompt: Schema.String,
	cc_message_id: Schema.optional(Schema.String),
});

/** @public */
export type UserPromptPayload = typeof UserPromptPayload.Type;
