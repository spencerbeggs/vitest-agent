import { Schema } from "effect";
/** @public */
export const FileEditPayload = Schema.Struct({
	type: Schema.Literal("file_edit"),
	file_path: Schema.String,
	edit_kind: Schema.Literal("write", "edit", "multi_edit"),
	lines_added: Schema.optional(Schema.Number),
	lines_removed: Schema.optional(Schema.Number),
	diff: Schema.optional(Schema.String),
});

/** @public */
export type FileEditPayload = typeof FileEditPayload.Type;
