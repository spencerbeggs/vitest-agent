import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

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

export const testTrends = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.String,
				limit: Schema.optional(Schema.Number),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;

				const limit = input.limit;

				const trendsOpt = yield* reader.getTrends(input.project, limit);

				if (Option.isNone(trendsOpt) || trendsOpt.value.entries.length === 0) {
					return `No trend data available for project \`${input.project}\`. Run tests multiple times to build trend history.`;
				}

				const trendRecord = trendsOpt.value;
				const entries = trendRecord.entries;
				const latest = entries[entries.length - 1];

				if (latest === undefined) {
					return `No trend data available for project \`${input.project}\`.`;
				}

				const directionIcon = latest.direction === "improving" ? "📈" : latest.direction === "regressing" ? "📉" : "➡️";

				const lines: string[] = [`# Coverage Trends: ${input.project}`, ""];

				lines.push(
					`${directionIcon} **Overall direction:** ${latest.direction} over ${entries.length} run${entries.length === 1 ? "" : "s"}`,
				);
				lines.push("");

				// Latest coverage values
				lines.push("## Latest Coverage");
				lines.push("");
				lines.push("| Metric | Value | Δ |");
				lines.push("| --- | --- | --- |");

				const metrics = ["statements", "branches", "functions", "lines"] as const;
				for (const metric of metrics) {
					const value = latest.coverage[metric];
					const delta = latest.delta[metric];
					const deltaStr = delta > 0 ? `+${delta.toFixed(2)}%` : delta < 0 ? `${delta.toFixed(2)}%` : "—";
					const deltaIcon = delta > 0.1 ? "↑" : delta < -0.1 ? "↓" : "";
					lines.push(`| ${metric} | ${value.toFixed(2)}% | ${deltaIcon} ${deltaStr} |`);
				}

				lines.push("");

				// Sparklines for each metric
				if (entries.length >= 2) {
					lines.push("## Trajectory");
					lines.push("");

					for (const metric of metrics) {
						const values = entries.map((e) => e.coverage[metric]);
						const sparkline = toSparkline(values);
						lines.push(`- **${metric}**: \`${sparkline}\``);
					}

					lines.push("");
				}

				// Recent entries table
				const recentEntries = entries.slice(-10);
				if (recentEntries.length > 0) {
					lines.push("## Recent Runs");
					lines.push("");
					lines.push("| Date | Lines | Branches | Functions | Statements | Direction |");
					lines.push("| --- | --- | --- | --- | --- | --- |");

					for (const entry of recentEntries) {
						const date = new Date(entry.timestamp).toLocaleDateString();
						const dirIcon = entry.direction === "improving" ? "📈" : entry.direction === "regressing" ? "📉" : "➡️";
						lines.push(
							`| ${date} | ${entry.coverage.lines.toFixed(1)}% | ${entry.coverage.branches.toFixed(1)}% | ${entry.coverage.functions.toFixed(1)}% | ${entry.coverage.statements.toFixed(1)}% | ${dirIcon} |`,
						);
					}

					lines.push("");
				}

				return lines.join("\n");
			}),
		);
	});
