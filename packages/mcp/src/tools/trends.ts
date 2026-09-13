// `test_trends` MCP tool — Schema-driven implementation.
//
// Wraps the existing `TrendRecord` Schema in a result envelope that
// carries the project name and a `dataAvailable` flag, so callers
// can distinguish "no trend data yet" from "data plus rendering"
// without parsing prose.

import { DataReader } from "@vitest-agent/engine";
import { TrendRecord } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

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
export const TestTrendsResult = Schema.Union([TrendsAvailable, TrendsAbsent]).annotate({
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

const SPARKLINE_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

function toSparkline(values: ReadonlyArray<number>): string {
	if (values.length === 0) return "";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min;
	return values
		.map((v) => {
			const index = range === 0 ? 4 : Math.round(((v - min) / range) * (SPARKLINE_CHARS.length - 1));
			return SPARKLINE_CHARS[index] ?? "▄";
		})
		.join("");
}

const directionIcon = (d: string): string => (d === "improving" ? "📈" : d === "regressing" ? "📉" : "➡️");

export const formatTestTrendsMarkdown = (data: TestTrendsResultType): string => {
	if (data.dataAvailable === false) {
		return `No trend data available for project \`${data.project}\`. Run tests multiple times to build trend history.`;
	}
	const entries = data.trends.entries;
	const latest = entries[entries.length - 1];
	if (latest === undefined) {
		return `No trend data available for project \`${data.project}\`.`;
	}

	const lines: string[] = [`# Coverage Trends: ${data.project}`, ""];
	lines.push(
		`${directionIcon(latest.direction)} **Overall direction:** ${latest.direction} over ${entries.length} run${entries.length === 1 ? "" : "s"}`,
	);
	lines.push("", "## Latest Coverage", "", "| Metric | Value | Δ |", "| --- | --- | --- |");

	const metrics = ["statements", "branches", "functions", "lines"] as const;
	for (const metric of metrics) {
		const value = latest.coverage[metric];
		const delta = latest.delta[metric];
		const deltaStr = delta > 0 ? `+${delta.toFixed(2)}%` : delta < 0 ? `${delta.toFixed(2)}%` : "—";
		const deltaIcon = delta > 0.1 ? "↑" : delta < -0.1 ? "↓" : "";
		lines.push(`| ${metric} | ${value.toFixed(2)}% | ${deltaIcon} ${deltaStr} |`);
	}
	lines.push("");

	if (entries.length >= 2) {
		lines.push("## Trajectory", "");
		for (const metric of metrics) {
			const values = entries.map((e) => e.coverage[metric]);
			lines.push(`- **${metric}**: \`${toSparkline(values)}\``);
		}
		lines.push("");
	}

	const recentEntries = entries.slice(-10);
	if (recentEntries.length > 0) {
		lines.push(
			"## Recent Runs",
			"",
			"| Date | Lines | Branches | Functions | Statements | Direction |",
			"| --- | --- | --- | --- | --- | --- |",
		);
		for (const entry of recentEntries) {
			const date = new Date(entry.timestamp).toLocaleDateString();
			lines.push(
				`| ${date} | ${entry.coverage.lines.toFixed(1)}% | ${entry.coverage.branches.toFixed(1)}% | ${entry.coverage.functions.toFixed(1)}% | ${entry.coverage.statements.toFixed(1)}% | ${directionIcon(entry.direction)} |`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
};

export const TestTrendsAsMarkdown = TestTrendsResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestTrendsMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "TestTrendsAsMarkdown is one-way: markdown cannot be parsed back to TestTrendsResult.",
		),
	}),
);

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
		"Use when you want to see whether a project's coverage is trending up or down over time. Returns markdown in content[] and a typed JSON object in structuredContent ({ dataAvailable, project, trends? }).",
	parameters: TestTrendsInput,
	success: TestTrendsResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test trends")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatTestTrendsMarkdown(encoded as TestTrendsResultType));
