// `test_trends` MCP tool — Schema-driven implementation.
//
// Wraps the existing `TrendRecord` Schema in a result envelope that
// carries the project name and a `dataAvailable` flag, so callers
// can distinguish "no trend data yet" from "data plus rendering"
// without parsing prose.

import { DataReader } from "@vitest-agent/engine";
import { TrendRecord } from "@vitest-agent/sdk";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { objectRootedUnion } from "./_union-schema.js";

const TrendsAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true).annotate({
		description: "Discriminant — `true` when at least one trend entry exists for the project.",
	}),
	project: Schema.String,
	trends: TrendRecord.annotate({
		description: "Trend entries oldest-first; the latest entry drives `direction` and the headline metrics.",
	}),
}).annotate({ identifier: "TestTrendsAvailable" });

const TrendsAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false).annotate({
		description: "Discriminant — `false` when fewer than two runs have been recorded for the project.",
	}),
	project: Schema.String,
}).annotate({ identifier: "TestTrendsAbsent" });

/**
 * The `test_trends` tool's success payload.
 *
 * @public
 */
export const TestTrendsResult = objectRootedUnion(Schema.Union([TrendsAvailable, TrendsAbsent])).annotate({
	identifier: "TestTrendsResult",
	title: "test_trends result",
	description: "Coverage trend record per project. Discriminate on `dataAvailable` to handle the cold-start case.",
});
/**
 * The decoded {@link TestTrendsResult}.
 *
 * @public
 */
export type TestTrendsResultType = Schema.Schema.Type<typeof TestTrendsResult>;

/**
 * The `test_trends` tool's parameters.
 *
 * @public
 */
export const TestTrendsInput = Schema.Struct({
	project: Schema.String.annotate({ description: "Project name (required)" }),
	limit: Schema.optionalKey(Schema.Finite).annotate({ description: "Max number of trend entries to return" }),
});
/**
 * The decoded {@link TestTrendsInput}.
 *
 * @public
 */
export type TestTrendsInputType = Schema.Schema.Type<typeof TestTrendsInput>;

/**
 * Handler for {@link testTrendsTool}.
 *
 * @public
 */
export const handleTestTrends = (input: TestTrendsInputType): Effect.Effect<TestTrendsResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const trendsOpt = yield* reader.getTrends(input.project, input.limit);
		if (Option.isNone(trendsOpt) || trendsOpt.value.entries.length === 0) {
			return { dataAvailable: false as const, project: input.project };
		}
		return {
			dataAvailable: true as const,
			project: input.project,
			trends: trendsOpt.value,
		};
	}).pipe(Effect.orDie);

/**
 * The Effect-native `test_trends` tool.
 *
 * @public
 */
export const testTrendsTool = Tool.make("test_trends", {
	description:
		"Use when you want to see whether a project's coverage is trending up or down over time. Returns a typed JSON object in structuredContent ({ dataAvailable, project, trends? }).",
	parameters: TestTrendsInput,
	success: TestTrendsResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test trends")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
