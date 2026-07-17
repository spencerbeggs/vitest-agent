/**
 * `triage_brief` MCP tool — Schema-driven implementation.
 *
 * The structured payload is a thin envelope around the markdown
 * rendering since this is a narrative tool — there's no underlying
 * record set the agent would parse separately. The `hasContent` flag
 * lets callers branch on the cold-start case without grepping prose.
 *
 * @packageDocumentation
 */

import { formatTriageEffect } from "@vitest-agent/sdk";
import { Effect, Schema } from "effect";
import { publicProcedure } from "../context.js";

export const TriageBriefResult = Schema.Struct({
	hasContent: Schema.Boolean.annotate({
		description: "`false` when no orientation signal is available yet (run tests to populate).",
	}),
	markdown: Schema.String.annotate({ description: "Pre-rendered markdown brief or the empty-state message." }),
}).annotate({
	identifier: "TriageBriefResult",
	title: "triage_brief result",
	description: "Orientation triage envelope. Branch on `hasContent` for cold-start; consume `markdown` for rendering.",
});
export type TriageBriefResultType = Schema.Schema.Type<typeof TriageBriefResult>;

export const triageBrief = publicProcedure
	.input(
		Schema.toStandardSchemaV1(
			Schema.Struct({
				project: Schema.optional(Schema.String),
				maxLines: Schema.optional(Schema.Number),
			}),
		),
	)
	.query(
		async ({ ctx, input }): Promise<TriageBriefResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const md = yield* formatTriageEffect({
						...(input.project !== undefined && { project: input.project }),
						...(input.maxLines !== undefined && { maxLines: input.maxLines }),
					});
					return md.length > 0
						? { hasContent: true, markdown: md }
						: { hasContent: false, markdown: "No orientation signal yet — run tests to populate the database." };
				}),
			),
	);
