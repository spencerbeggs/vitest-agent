/**
 * Consolidated `hypothesis` MCP tool — Schema-driven implementation.
 *
 * `record` and `validate` are mutations whose result is a small
 * structured envelope. `list` now returns a structured array; the
 * boundary in server.ts renders it as markdown via the exported
 * `formatHypothesisListMarkdown` helper.
 *
 * @packageDocumentation
 */

import { Effect, Match, Schema } from "effect";
import { DataReader, DataStore } from "vitest-agent-sdk";
import { idempotentProcedure } from "../middleware/idempotency.js";

const HypothesisRowSchema = Schema.Struct({
	id: Schema.Number,
	sessionId: Schema.Number,
	content: Schema.String.annotations({
		description: "Free-text hypothesis the agent recorded before attempting a fix.",
	}),
	citedTestErrorId: Schema.NullOr(Schema.Number).annotations({
		description: "Optional `test_errors.id` the hypothesis cites as the failing observation.",
	}),
	citedStackFrameId: Schema.NullOr(Schema.Number).annotations({
		description: "Optional `stack_frames.id` for the specific frame the hypothesis blames.",
	}),
	validationOutcome: Schema.NullOr(Schema.Literal("confirmed", "refuted", "abandoned")).annotations({
		description: "Outcome recorded by `hypothesis (action: validate)`; `null` while still open.",
	}),
	validatedAt: Schema.NullOr(Schema.String).annotations({
		description: "ISO-8601 validation timestamp; `null` while open.",
	}),
}).annotations({ identifier: "HypothesisRow" });

const HypothesisRecordOk = Schema.Struct({
	action: Schema.Literal("record"),
	id: Schema.Number.annotations({ description: "Newly inserted hypothesis row primary key." }),
});

const HypothesisValidateOk = Schema.Struct({
	action: Schema.Literal("validate"),
});

const HypothesisListOk = Schema.Struct({
	action: Schema.Literal("list"),
	count: Schema.Number,
	hypotheses: Schema.Array(HypothesisRowSchema),
});

export const HypothesisResult = Schema.Union(HypothesisRecordOk, HypothesisValidateOk, HypothesisListOk).annotations({
	identifier: "HypothesisResult",
	title: "hypothesis result",
	description:
		"Discriminate on `action`. record returns the new id; list returns the matching rows; validate returns an empty acknowledgement.",
});
export type HypothesisResultType = Schema.Schema.Type<typeof HypothesisResult>;

export const formatHypothesisListMarkdown = (data: HypothesisResultType): string => {
	if (data.action !== "list") return JSON.stringify(data, null, 2);
	if (data.hypotheses.length === 0) return "No hypotheses matched.";
	const lines: string[] = ["# Hypotheses", ""];
	for (const h of data.hypotheses) {
		const status = h.validationOutcome ?? "open";
		lines.push(`- [${status}] id=${h.id} session=${h.sessionId}: ${h.content.slice(0, 120)}`);
	}
	return lines.join("\n");
};

const RecordVariant = Schema.Struct({
	action: Schema.Literal("record"),
	sessionId: Schema.Number,
	content: Schema.String,
	createdTurnId: Schema.optional(Schema.Number),
	citedTestErrorId: Schema.optional(Schema.Number),
	citedStackFrameId: Schema.optional(Schema.Number),
});

const ValidateVariant = Schema.Struct({
	action: Schema.Literal("validate"),
	id: Schema.Number,
	outcome: Schema.Literal("confirmed", "refuted", "abandoned"),
	validatedTurnId: Schema.optional(Schema.Number),
	validatedAt: Schema.String,
});

const ListVariant = Schema.Struct({
	action: Schema.Literal("list"),
	sessionId: Schema.optional(Schema.Number),
	outcome: Schema.optional(Schema.Literal("confirmed", "refuted", "abandoned", "open")),
	limit: Schema.optional(Schema.Number),
});

const HypothesisInput = Schema.Union(RecordVariant, ValidateVariant, ListVariant);

export const hypothesis = idempotentProcedure
	.input(Schema.standardSchemaV1(HypothesisInput))
	.mutation(async ({ ctx, input }): Promise<HypothesisResultType> => {
		return ctx.runtime.runPromise(
			Match.value(input).pipe(
				Match.discriminatorsExhaustive("action")({
					record: (variant) =>
						Effect.gen(function* () {
							const store = yield* DataStore;
							const id = yield* store.writeHypothesis({
								sessionId: variant.sessionId,
								content: variant.content,
								...(variant.createdTurnId !== undefined && { createdTurnId: variant.createdTurnId }),
								...(variant.citedTestErrorId !== undefined && { citedTestErrorId: variant.citedTestErrorId }),
								...(variant.citedStackFrameId !== undefined && { citedStackFrameId: variant.citedStackFrameId }),
							});
							return { action: "record" as const, id };
						}),
					validate: (variant) =>
						Effect.gen(function* () {
							const store = yield* DataStore;
							yield* store.validateHypothesis({
								id: variant.id,
								outcome: variant.outcome,
								validatedAt: variant.validatedAt,
								...(variant.validatedTurnId !== undefined && { validatedTurnId: variant.validatedTurnId }),
							});
							return { action: "validate" as const };
						}),
					list: (variant) =>
						Effect.gen(function* () {
							const reader = yield* DataReader;
							const rows = yield* reader.listHypotheses({
								...(variant.sessionId !== undefined && { sessionId: variant.sessionId }),
								...(variant.outcome !== undefined && { outcome: variant.outcome }),
								...(variant.limit !== undefined && { limit: variant.limit }),
							});
							return { action: "list" as const, count: rows.length, hypotheses: rows };
						}),
				}),
			),
		);
	});
