import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const fileCoverage = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				filePath: Schema.String,
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

				// Search lowCoverage for the file (try exact match, then suffix match)
				const normalizedPath = input.filePath.replace(/^\.\//, "");
				let match = coverage.lowCoverage.find((f) => f.file === normalizedPath);
				if (!match) {
					match = coverage.lowCoverage.find((f) => f.file.endsWith(normalizedPath) || normalizedPath.endsWith(f.file));
				}

				const lines: string[] = [`# Coverage: \`${normalizedPath}\``, ""];

				if (match) {
					const metrics = ["statements", "branches", "functions", "lines"] as const;
					lines.push("## Metrics", "");
					lines.push("| Metric | Value | Threshold |");
					lines.push("| --- | --- | --- |");

					for (const metric of metrics) {
						const value = match.summary[metric];
						const threshold = coverage.thresholds.global[metric];
						const thresholdStr = threshold !== undefined ? `${threshold}%` : "\u2014";
						const icon = threshold !== undefined && value < threshold ? "\u274C" : "\u2705";
						lines.push(`| ${metric} | ${icon} ${value.toFixed(2)}% | ${thresholdStr} |`);
					}

					if (match.uncoveredLines) {
						lines.push("");
						lines.push(`## Uncovered Lines`);
						lines.push("");
						lines.push(`\`${match.uncoveredLines}\``);
					}

					lines.push("");
					lines.push("## Next steps", "");
					lines.push("- Use test_for_file to find tests covering this file");
					lines.push("- Write tests targeting the uncovered lines");
				} else {
					// File not in lowCoverage — either fully covered or not in coverage data
					lines.push("This file is not in the low-coverage list.");
					lines.push("");
					lines.push("Possible reasons:");
					lines.push("- File meets all coverage thresholds");
					lines.push("- File was not included in the coverage run");
					lines.push("- File path does not match any tracked source file");
					lines.push("");

					// Show global totals for context
					const { totals } = coverage;
					lines.push("## Project Coverage Totals", "");
					lines.push("| Metric | Value |");
					lines.push("| --- | --- |");
					lines.push(`| statements | ${totals.statements.toFixed(2)}% |`);
					lines.push(`| branches | ${totals.branches.toFixed(2)}% |`);
					lines.push(`| functions | ${totals.functions.toFixed(2)}% |`);
					lines.push(`| lines | ${totals.lines.toFixed(2)}% |`);
				}

				// Related tests
				const testFiles = yield* reader.getTestsForFile(normalizedPath);
				if (testFiles.length > 0) {
					lines.push("");
					lines.push("## Tests Covering This File", "");
					for (const tf of testFiles) {
						lines.push(`- \`${tf}\``);
					}
				}

				return lines.join("\n");
			}),
		);
	});
