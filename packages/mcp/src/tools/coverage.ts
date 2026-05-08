import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testCoverage = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.optional(Schema.String),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;

				const project = input.project ?? "default";

				const coverageOpt = yield* reader.getCoverage(project);

				if (Option.isNone(coverageOpt)) {
					return "No coverage data available. Run tests with coverage enabled.";
				}

				const coverage = coverageOpt.value;

				const lines: string[] = ["# Coverage Report", ""];

				const { totals, thresholds } = coverage;

				lines.push("## Totals");
				lines.push("");
				lines.push("| Metric | Value | Threshold |");
				lines.push("| --- | --- | --- |");

				const metrics = ["statements", "branches", "functions", "lines"] as const;
				for (const metric of metrics) {
					const value = totals[metric];
					const threshold = thresholds.global[metric];
					const thresholdStr = threshold !== undefined ? `${threshold}%` : "\u2014";
					const icon = threshold !== undefined && value < threshold ? "\u274C" : "\u2705";
					lines.push(`| ${metric} | ${icon} ${value.toFixed(2)}% | ${thresholdStr} |`);
				}

				lines.push("");

				if (coverage.lowCoverage.length > 0) {
					lines.push("## Coverage Gaps");
					lines.push("");
					lines.push("Files below coverage threshold:");
					lines.push("");

					for (const fileCoverage of coverage.lowCoverage) {
						lines.push(`### \`${fileCoverage.file}\``);
						lines.push("");
						lines.push("| Metric | Value |");
						lines.push("| --- | --- |");
						for (const metric of metrics) {
							lines.push(`| ${metric} | ${fileCoverage.summary[metric].toFixed(2)}% |`);
						}
						if (fileCoverage.uncoveredLines) {
							lines.push(`| Uncovered lines | \`${fileCoverage.uncoveredLines}\` |`);
						}
						lines.push("");
					}
				} else {
					lines.push("\u2705 All files meet coverage thresholds.");
					lines.push("");
				}

				return lines.join("\n");
			}),
		);
	});
