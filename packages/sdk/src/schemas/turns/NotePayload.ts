import { Schema } from "effect";
/** @public */
export const NotePayload = Schema.Struct({
	type: Schema.Literal("note"),
	scope: Schema.String,
	title: Schema.optional(Schema.String),
	content: Schema.String,
});

/** @public */
export type NotePayload = typeof NotePayload.Type;
