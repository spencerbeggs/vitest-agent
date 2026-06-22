import { Schema } from "effect";
/** @public */
export const HypothesisPayload = Schema.Struct({
	type: Schema.Literal("hypothesis"),
	content: Schema.String,
	cited_test_error_id: Schema.optional(Schema.Number),
	cited_stack_frame_id: Schema.optional(Schema.Number),
});

/** @public */
export type HypothesisPayload = typeof HypothesisPayload.Type;
