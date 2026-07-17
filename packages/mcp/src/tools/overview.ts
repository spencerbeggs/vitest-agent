/**
 * `test_overview` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

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

export const TestOverviewResult = Schema.Union([OverviewAvailable, OverviewAbsent]).annotate({
	identifier: "TestOverviewResult",
	title: "test_overview result",
	description: "Per-project run metrics. Discriminate on `dataAvailable` for cold-start handling.",
});
export type TestOverviewResultType = Schema.Schema.Type<typeof TestOverviewResult>;

const iconForResult = (r: string | null): string => {
	if (r === "passed") return "✅";
	if (r === "failed") return "❌";
	if (r === "interrupted") return "⚠️";
	return "⬜";
};

export const formatTestOverviewMarkdown = (data: TestOverviewResultType): string => {
	if (!data.dataAvailable) {
		if (data.reason === "project_filter_empty") {
			return `No test data found for project \`${data.projectFilter ?? "(unknown)"}\`. Run tests first.`;
		}
		return "No test data available. Run tests first.";
	}
	const lines: string[] = ["# Test Overview", ""];
	type RunRow = Schema.Schema.Type<typeof ProjectRunSummary>;
	const projectGroups = new Map<string, Array<RunRow>>();
	for (const run of data.runs) {
		const group = projectGroups.get(run.project) ?? [];
		group.push(run);
		projectGroups.set(run.project, group);
	}
	for (const [projectName, projectRuns] of projectGroups) {
		lines.push(`## ${projectName}`, "");
		for (const run of projectRuns) {
			const lastRun = run.lastRun ? new Date(run.lastRun).toLocaleString() : "never";
			lines.push(
				`### ${iconForResult(run.lastResult)} ${run.project}`,
				"",
				"| Metric | Count |",
				"| --- | --- |",
				`| Total | ${run.total} |`,
				`| Passed | ${run.passed} |`,
				`| Failed | ${run.failed} |`,
				`| Skipped | ${run.skipped} |`,
				`| Last run | ${lastRun} |`,
				"",
			);
		}
	}
	return lines.join("\n");
};

export const TestOverviewAsMarkdown = TestOverviewResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestOverviewMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TestOverviewAsMarkdown is one-way."),
	}),
);

export const testOverview = publicProcedure
	.input(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.optional(Schema.String) })))
	.query(
		async ({ ctx, input }): Promise<TestOverviewResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const [manifestOpt, runs] = yield* Effect.all([reader.getManifest(), reader.getRunsByProject()]);
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
				}),
			),
	);
