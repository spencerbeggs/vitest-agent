/**
 * `tdd_artifact_list` MCP tool — Schema-driven implementation.
 *
 * Returns the artifacts recorded for a TDD task, ordered with the
 * most recent first. The structuredContent payload carries
 * tddTaskId, the applied filters, the count, and the artifact
 * rows so the orchestrator can extract artifact ids without parsing
 * markdown. The legacy `format` input was dropped because
 * structuredContent supersedes it.
 *
 * @packageDocumentation
 */

import { Effect, ParseResult, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const ArtifactKindSchema = Schema.Literal(
	"test_written",
	"test_failed_run",
	"code_written",
	"test_passed_run",
	"refactor",
	"test_weakened",
);

const TddArtifactRow = Schema.Struct({
	id: Schema.Number.annotations({
		title: "tdd_artifacts.id",
		description: "Pass as `citedArtifactId` to `tdd_phase_transition_request`.",
	}),
	tddTaskId: Schema.Number,
	phaseId: Schema.Number,
	phaseName: Schema.Literal(
		"spike",
		"red",
		"red.triangulate",
		"green",
		"green.fake-it",
		"refactor",
		"extended-red",
		"green-without-red",
	),
	artifactKind: ArtifactKindSchema,
	behaviorId: Schema.NullOr(Schema.Number),
	testCaseId: Schema.NullOr(Schema.Number),
	testRunId: Schema.NullOr(Schema.Number),
	testFirstFailureRunId: Schema.NullOr(Schema.Number),
	recordedAt: Schema.String,
}).annotations({ identifier: "TddArtifactListRow" });

const ArtifactFilters = Schema.Struct({
	artifactKind: Schema.optional(ArtifactKindSchema),
	phaseId: Schema.optional(Schema.Number),
	behaviorId: Schema.optional(Schema.Number),
}).annotations({ identifier: "TddArtifactFilters" });

export const TddArtifactListResult = Schema.Struct({
	tddTaskId: Schema.Number,
	filters: ArtifactFilters,
	count: Schema.Number,
	artifacts: Schema.Array(TddArtifactRow),
}).annotations({
	identifier: "TddArtifactListResult",
	title: "tdd_artifact_list result",
	description:
		"Newest-first artifact rows for a TDD task. Echoes the filters that were applied so callers can reason about what is/isn't included.",
});
export type TddArtifactListResultType = Schema.Schema.Type<typeof TddArtifactListResult>;

const describeFilters = (filters: Schema.Schema.Type<typeof ArtifactFilters>): string => {
	const parts: string[] = [];
	if (filters.artifactKind !== undefined) parts.push(`artifactKind=${filters.artifactKind}`);
	if (filters.phaseId !== undefined) parts.push(`phaseId=${filters.phaseId}`);
	if (filters.behaviorId !== undefined) parts.push(`behaviorId=${filters.behaviorId}`);
	return parts.length > 0 ? ` matching ${parts.join(", ")}` : "";
};

export const formatTddArtifactListMarkdown = (data: TddArtifactListResultType): string => {
	if (data.count === 0) {
		return `No artifacts recorded for tdd_task ${data.tddTaskId}${describeFilters(data.filters)}.`;
	}
	const lines: string[] = [`# Artifacts for tdd_task ${data.tddTaskId} (newest first, ${data.count} shown)`, ""];
	for (const r of data.artifacts) {
		const extras: string[] = [`phase=${r.phaseName} [phaseId=${r.phaseId}]`];
		if (r.behaviorId !== null) extras.push(`behaviorId=${r.behaviorId}`);
		if (r.testCaseId !== null) extras.push(`testCaseId=${r.testCaseId}`);
		if (r.testRunId !== null) extras.push(`testRunId=${r.testRunId}`);
		lines.push(`- **${r.artifactKind}** [id=${r.id}] at=${r.recordedAt} ${extras.join(" ")}`);
	}
	return lines.join("\n");
};

export const TddArtifactListAsMarkdown = Schema.transformOrFail(TddArtifactListResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatTddArtifactListMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "TddArtifactListAsMarkdown is one-way.")),
});

const TddArtifactListInput = Schema.Struct({
	tddTaskId: Schema.Number,
	artifactKind: Schema.optional(ArtifactKindSchema),
	phaseId: Schema.optional(Schema.Number),
	behaviorId: Schema.optional(Schema.Number),
	limit: Schema.optional(Schema.Number),
});

export const tddArtifactList = publicProcedure.input(Schema.standardSchemaV1(TddArtifactListInput)).query(
	async ({ ctx, input }): Promise<TddArtifactListResultType> =>
		ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const rows = yield* reader.listTddArtifactsForTask({
					tddTaskId: input.tddTaskId,
					...(input.artifactKind !== undefined && { artifactKind: input.artifactKind }),
					...(input.phaseId !== undefined && { phaseId: input.phaseId }),
					...(input.behaviorId !== undefined && { behaviorId: input.behaviorId }),
					...(input.limit !== undefined && { limit: input.limit }),
				});
				return {
					tddTaskId: input.tddTaskId,
					filters: {
						...(input.artifactKind !== undefined && { artifactKind: input.artifactKind }),
						...(input.phaseId !== undefined && { phaseId: input.phaseId }),
						...(input.behaviorId !== undefined && { behaviorId: input.behaviorId }),
					},
					count: rows.length,
					artifacts: rows,
				};
			}),
		),
);
