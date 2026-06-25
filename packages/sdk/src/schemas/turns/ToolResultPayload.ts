import { Schema } from "effect";
/** @public */
export const ToolResultPayload = Schema.Struct({
	type: Schema.Literal("tool_result"),
	tool_name: Schema.String,
	tool_use_id: Schema.optional(Schema.String),
	result_summary: Schema.optional(Schema.String),
	success: Schema.Boolean,
	duration_ms: Schema.optional(Schema.Number),
});

/** @public */
export type ToolResultPayload = typeof ToolResultPayload.Type;
