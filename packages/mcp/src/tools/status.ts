/**
 * `test_status` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { CacheManifestEntry, DataReader } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const StatusAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true).annotate({
		description: "Discriminant — `true` when at least one project entry exists in the manifest.",
	}),
	manifestUpdatedAt: Schema.String,
	projectFilter: Schema.optional(Schema.String).annotate({
		description: "Echo of the optional `project` filter.",
	}),
	entries: Schema.Array(CacheManifestEntry).annotate({
		description: "Per-project last-run summary rows. Filtered by `projectFilter` when set.",
	}),
}).annotate({ identifier: "TestStatusAvailable" });

const StatusAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false).annotate({
		description: "Discriminant — `false` when no manifest exists or the project filter matched nothing.",
	}),
	projectFilter: Schema.optional(Schema.String),
	reason: Schema.Literals(["no_manifest", "project_filter_empty"]),
}).annotate({ identifier: "TestStatusAbsent" });

export const TestStatusResult = Schema.Union([StatusAvailable, StatusAbsent]).annotate({
	identifier: "TestStatusResult",
	title: "test_status result",
	description: "Per-project last-run summary. Discriminate on `dataAvailable` for cold-start handling.",
});
export type TestStatusResultType = Schema.Schema.Type<typeof TestStatusResult>;

const iconForResult = (r: string | null): string => {
	if (r === "passed") return "✅";
	if (r === "failed") return "❌";
	if (r === "interrupted") return "⚠️";
	return "⬜";
};

export const formatTestStatusMarkdown = (data: TestStatusResultType): string => {
	if (!data.dataAvailable) {
		if (data.reason === "project_filter_empty") {
			return `No test data found for project \`${data.projectFilter ?? "(unknown)"}\`. Run tests first.`;
		}
		return "No test data available. Run tests first.";
	}
	const lines: string[] = ["# Test Status", ""];
	for (const entry of data.entries) {
		const lastRun = entry.lastRun ? new Date(entry.lastRun).toLocaleString() : "never";
		lines.push(
			`- ${iconForResult(entry.lastResult)} **${entry.project}** — last run: ${lastRun}, result: ${entry.lastResult ?? "unknown"}`,
		);
	}
	lines.push("", `_Cache updated: ${data.manifestUpdatedAt}_`);
	return lines.join("\n");
};

export const TestStatusAsMarkdown = TestStatusResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestStatusMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TestStatusAsMarkdown is one-way."),
	}),
);

export const testStatus = publicProcedure
	.input(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.optional(Schema.String) })))
	.query(
		async ({ ctx, input }): Promise<TestStatusResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const manifestOpt = yield* reader.getManifest();
					if (Option.isNone(manifestOpt)) {
						return {
							dataAvailable: false as const,
							reason: "no_manifest" as const,
							...(input.project !== undefined && { projectFilter: input.project }),
						};
					}
					const manifest = manifestOpt.value;
					const entries =
						input.project === undefined
							? manifest.projects
							: manifest.projects.filter((e) => e.project === input.project);
					if (entries.length === 0) {
						return {
							dataAvailable: false as const,
							reason: "project_filter_empty" as const,
							...(input.project !== undefined && { projectFilter: input.project }),
						};
					}
					return {
						dataAvailable: true as const,
						manifestUpdatedAt: manifest.updatedAt,
						...(input.project !== undefined && { projectFilter: input.project }),
						entries,
					};
				}),
			),
	);
