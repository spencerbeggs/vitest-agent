// `tdd_artifact_list` MCP tool — Schema-driven implementation.
//
// Returns the artifacts recorded for a TDD task, ordered with the
// most recent first. The structuredContent payload carries
// tddTaskId, the applied filters, the count, and the artifact
// rows so the orchestrator can extract artifact ids without parsing
// markdown. The legacy `format` input was dropped because
// structuredContent supersedes it.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const ArtifactKindSchema = Schema.Literals([
	"test_written",
	"test_failed_run",
	"code_written",
	"test_passed_run",
	"refactor",
	"test_weakened",
]);

const TddArtifactRow = Schema.Struct({
	id: Schema.Finite.annotate({
		title: "tdd_artifacts.id",
		description: "Pass as `citedArtifactId` to `tdd_phase_transition_request`.",
	}),
	tddTaskId: Schema.Number,
	phaseId: Schema.Number,
	phaseName: Schema.Literals([
		"spike",
		"red",
		"red.triangulate",
		"green",
		"green.fake-it",
		"refactor",
		"extended-red",
		"green-without-red",
	]),
	artifactKind: ArtifactKindSchema,
	behaviorId: Schema.NullOr(Schema.Number),
	testCaseId: Schema.NullOr(Schema.Number),
	testRunId: Schema.NullOr(Schema.Number),
	testFirstFailureRunId: Schema.NullOr(Schema.Number),
	recordedAt: Schema.String,
	suite: Schema.Literals(["vitest", "bats"]).annotate({
		description: "Which test runner produced this artifact — a bats run carries no test_case_id.",
	}),
}).annotate({ identifier: "TddArtifactListRow" });

const ArtifactFilters = Schema.Struct({
	artifactKind: Schema.optional(ArtifactKindSchema),
	phaseId: Schema.optional(Schema.Number),
	behaviorId: Schema.optional(Schema.Number),
}).annotate({ identifier: "TddArtifactFilters" });

/**
 * The `tdd_artifact_list` tool's success payload.
 *
 * @public
 */
export const TddArtifactListResult = Schema.Struct({
	tddTaskId: Schema.Number,
	filters: ArtifactFilters,
	count: Schema.Number,
	artifacts: Schema.Array(TddArtifactRow),
}).annotate({
	identifier: "TddArtifactListResult",
	title: "tdd_artifact_list result",
	description:
		"Newest-first artifact rows for a TDD task. Echoes the filters that were applied so callers can reason about what is/isn't included.",
});
/**
 * The decoded {@link TddArtifactListResult}.
 *
 * @public
 */
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
		const extras: string[] = [`phase=${r.phaseName} [phaseId=${r.phaseId}]`, `suite=${r.suite}`];
		if (r.behaviorId !== null) extras.push(`behaviorId=${r.behaviorId}`);
		if (r.testCaseId !== null) extras.push(`testCaseId=${r.testCaseId}`);
		if (r.testRunId !== null) extras.push(`testRunId=${r.testRunId}`);
		lines.push(`- **${r.artifactKind}** [id=${r.id}] at=${r.recordedAt} ${extras.join(" ")}`);
	}
	return lines.join("\n");
};

export const TddArtifactListAsMarkdown = TddArtifactListResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTddArtifactListMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TddArtifactListAsMarkdown is one-way."),
	}),
);

/**
 * The `tdd_artifact_list` tool's parameters.
 *
 * @public
 */
export const TddArtifactListInput = Schema.Struct({
	tddTaskId: Schema.Finite.annotate({ description: "tdd_tasks.id" }),
	artifactKind: Schema.optionalKey(ArtifactKindSchema).annotate({ description: "Restrict to one artifact kind" }),
	phaseId: Schema.optionalKey(Schema.Finite).annotate({ description: "Restrict to artifacts recorded in one phase" }),
	behaviorId: Schema.optionalKey(Schema.Finite).annotate({
		description: "Restrict to artifacts recorded in phases bound to one behavior",
	}),
	limit: Schema.optionalKey(Schema.Finite).annotate({ description: "Max rows (default 50)" }),
});
/**
 * The decoded {@link TddArtifactListInput}.
 *
 * @public
 */
export type TddArtifactListInputType = Schema.Schema.Type<typeof TddArtifactListInput>;

/**
 * Handler for {@link tddArtifactListTool}.
 *
 * @public
 */
export const handleTddArtifactList = (
	input: TddArtifactListInputType,
): Effect.Effect<TddArtifactListResultType, never, DataReader> =>
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
	}).pipe(Effect.orDie);

/**
 * The Effect-native `tdd_artifact_list` tool.
 *
 * @public
 */
export const tddArtifactListTool = Tool.make("tdd_artifact_list", {
	description:
		"Use when you need the artifact id to cite in tdd_phase_transition_request without querying SQLite directly. Lists TDD artifacts (test_written, test_failed_run, code_written, test_passed_run, refactor, test_weakened) for a tdd_task, newest first. Filters: artifactKind, phaseId, behaviorId, limit (default 50).",
	parameters: TddArtifactListInput,
	success: TddArtifactListResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "TDD artifact list")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatTddArtifactListMarkdown(encoded as TddArtifactListResultType));
