// `test_overview` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { objectRootedUnion } from "./_union-schema.js";

const ProjectRunSummary = Schema.Struct({
	project: Schema.String,
	lastRun: Schema.NullOr(Schema.String),
	lastResult: Schema.NullOr(Schema.Literals(["passed", "failed", "interrupted"])),
	total: Schema.Number,
	passed: Schema.Number,
	failed: Schema.Number,
	skipped: Schema.Number,
}).annotate({ identifier: "ProjectRunSummary", description: "One row per project's most recent run summary." });

const OverviewAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	projectFilter: Schema.optional(Schema.String),
	runs: Schema.Array(ProjectRunSummary),
}).annotate({ identifier: "TestOverviewAvailable" });

const OverviewAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false),
	projectFilter: Schema.optional(Schema.String),
	reason: Schema.Literals(["no_runs", "project_filter_empty"]),
}).annotate({ identifier: "TestOverviewAbsent" });

/**
 * The `test_overview` tool's success payload.
 *
 * @public
 */
export const TestOverviewResult = objectRootedUnion(Schema.Union([OverviewAvailable, OverviewAbsent])).annotate({
	identifier: "TestOverviewResult",
	title: "test_overview result",
	description: "Per-project run metrics. Discriminate on `dataAvailable` for cold-start handling.",
});
/**
 * The decoded {@link TestOverviewResult}.
 *
 * @public
 */
export type TestOverviewResultType = Schema.Schema.Type<typeof TestOverviewResult>;

/**
 * The `test_overview` tool's parameters.
 *
 * @public
 */
export const TestOverviewInput = Schema.Struct({
	project: Schema.optionalKey(Schema.String).annotate({ description: "Filter to a specific project" }),
});
/**
 * The decoded {@link TestOverviewInput}.
 *
 * @public
 */
export type TestOverviewInputType = Schema.Schema.Type<typeof TestOverviewInput>;

/**
 * Handler for {@link testOverviewTool}.
 *
 * @public
 */
export const handleTestOverview = (
	input: TestOverviewInputType,
): Effect.Effect<TestOverviewResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		// Effect.all defaults to sequential execution. Keep concurrency
		// explicit here so independent reads are scheduled together.
		const [manifestOpt, runs] = yield* Effect.all([reader.getManifest(), reader.getRunsByProject()], {
			concurrency: "unbounded",
		});
		if (Option.isNone(manifestOpt) || runs.length === 0) {
			return {
				dataAvailable: false as const,
				reason: "no_runs" as const,
				...(input.project !== undefined && { projectFilter: input.project }),
			};
		}
		const filteredRuns = input.project === undefined ? runs : runs.filter((r) => r.project === input.project);
		if (filteredRuns.length === 0) {
			return {
				dataAvailable: false as const,
				reason: "project_filter_empty" as const,
				...(input.project !== undefined && { projectFilter: input.project }),
			};
		}
		return {
			dataAvailable: true as const,
			...(input.project !== undefined && { projectFilter: input.project }),
			runs: filteredRuns,
		};
	}).pipe(Effect.orDie);

/**
 * The Effect-native `test_overview` tool.
 *
 * @public
 */
export const testOverviewTool = Tool.make("test_overview", {
	description:
		"Use when you want a summary of the test landscape with per-project run metrics. Returns a typed JSON object in structuredContent ({ dataAvailable, projectFilter?, runs[] } or absent variant).",
	parameters: TestOverviewInput,
	success: TestOverviewResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test overview")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
