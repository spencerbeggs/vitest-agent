// `triage_brief` MCP tool — Schema-driven implementation.
//
// The structured payload is a thin envelope around the markdown
// rendering since this is a narrative tool — there's no underlying
// record set the agent would parse separately. The `hasContent` flag
// lets callers branch on the cold-start case without grepping prose.

import { DataReader, formatTriageEffect } from "@vitest-agent/engine";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

/**
 * The `triage_brief` tool's success payload.
 *
 * @public
 */
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
/**
 * The decoded {@link TriageBriefResult}.
 *
 * @public
 */
export type TriageBriefResultType = Schema.Schema.Type<typeof TriageBriefResult>;

/**
 * The `triage_brief` tool's parameters.
 *
 * @public
 */
export const TriageBriefInput = Schema.Struct({
	project: Schema.optionalKey(Schema.String).annotate({ description: "Filter to a specific project" }),
	maxLines: Schema.optionalKey(Schema.Finite).annotate({ description: "Soft cap on rendered output lines" }),
});
/**
 * The decoded {@link TriageBriefInput}.
 *
 * @public
 */
export type TriageBriefInputType = Schema.Schema.Type<typeof TriageBriefInput>;

/**
 * Handler for {@link triageBriefTool}.
 *
 * @public
 */
export const handleTriageBrief = (
	input: TriageBriefInputType,
): Effect.Effect<TriageBriefResultType, never, DataReader> =>
	Effect.gen(function* () {
		const md = yield* formatTriageEffect({
			...(input.project !== undefined && { project: input.project }),
			...(input.maxLines !== undefined && { maxLines: input.maxLines }),
		});
		return md.length > 0
			? { hasContent: true, markdown: md }
			: { hasContent: false, markdown: "No orientation signal yet — run tests to populate the database." };
	});

/**
 * The Effect-native `triage_brief` tool. The text channel is the
 * pre-rendered `markdown` field itself.
 *
 * @public
 */
export const triageBriefTool = Tool.make("triage_brief", {
	description:
		"Use when you need to orient on the current test landscape: failing tests, flaky tests, open TDD sessions, and suggested next actions. Returns markdown in content[] and a typed envelope in structuredContent ({ hasContent, markdown }).",
	parameters: TriageBriefInput,
	success: TriageBriefResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Triage brief")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => (encoded as TriageBriefResultType).markdown);
