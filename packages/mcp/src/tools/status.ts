// `test_status` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { CacheManifestEntry } from "@vitest-agent/sdk";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

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

/**
 * The `test_status` tool's success payload.
 *
 * @public
 */
export const TestStatusResult = Schema.Union([StatusAvailable, StatusAbsent]).annotate({
	identifier: "TestStatusResult",
	title: "test_status result",
	description: "Per-project last-run summary. Discriminate on `dataAvailable` for cold-start handling.",
});
/**
 * The decoded {@link TestStatusResult}.
 *
 * @public
 */
export type TestStatusResultType = Schema.Schema.Type<typeof TestStatusResult>;

/**
 * The `test_status` tool's parameters.
 *
 * @public
 */
export const TestStatusInput = Schema.Struct({
	project: Schema.optionalKey(Schema.String).annotate({ description: "Filter to a specific project" }),
});
/**
 * The decoded {@link TestStatusInput}.
 *
 * @public
 */
export type TestStatusInputType = Schema.Schema.Type<typeof TestStatusInput>;

/**
 * Handler for {@link testStatusTool}: the single implementation of the
 * tool.
 *
 * @public
 */
export const handleTestStatus = (input: TestStatusInputType): Effect.Effect<TestStatusResultType, never, DataReader> =>
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
			input.project === undefined ? manifest.projects : manifest.projects.filter((e) => e.project === input.project);
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
	}).pipe(Effect.orDie);

/**
 * The Effect-native `test_status` tool.
 *
 * @public
 */
export const testStatusTool = Tool.make("test_status", {
	description:
		"Use when you need each project's current pass/fail state from the most recent run. Returns a typed JSON object in structuredContent ({ dataAvailable, manifestUpdatedAt, projectFilter?, entries[] } or absent variant).",
	parameters: TestStatusInput,
	success: TestStatusResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test status")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
