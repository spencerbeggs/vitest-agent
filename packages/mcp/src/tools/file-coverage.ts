/**
 * `file_coverage` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { Effect, Option, ParseResult, Schema } from "effect";
import { CoverageTotals, DataReader, FileCoverageReport } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const CoverageGlobalThresholds = Schema.Struct({
	statements: Schema.optional(Schema.Number),
	branches: Schema.optional(Schema.Number),
	functions: Schema.optional(Schema.Number),
	lines: Schema.optional(Schema.Number),
});

const FileCoverageMatched = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	matched: Schema.Literal(true),
	filePath: Schema.String,
	report: FileCoverageReport,
	globalThresholds: CoverageGlobalThresholds,
	relatedTestFiles: Schema.Array(Schema.String),
}).annotations({ identifier: "FileCoverageMatched" });

const FileCoverageNoMatch = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	matched: Schema.Literal(false),
	filePath: Schema.String,
	totals: CoverageTotals,
	relatedTestFiles: Schema.Array(Schema.String),
}).annotations({ identifier: "FileCoverageNoMatch" });

const FileCoverageAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false),
	filePath: Schema.String,
}).annotations({ identifier: "FileCoverageAbsent" });

export const FileCoverageResult = Schema.Union(
	FileCoverageMatched,
	FileCoverageNoMatch,
	FileCoverageAbsent,
).annotations({
	identifier: "FileCoverageResult",
	title: "file_coverage result",
	description: "Per-file coverage with related tests. Discriminate on `dataAvailable` then on `matched`.",
});
export type FileCoverageResultType = Schema.Schema.Type<typeof FileCoverageResult>;

export const formatFileCoverageMarkdown = (data: FileCoverageResultType): string => {
	if (!data.dataAvailable) return "No coverage data available. Run tests with coverage enabled.";

	const lines: string[] = [`# Coverage: \`${data.filePath}\``, ""];
	const metrics = ["statements", "branches", "functions", "lines"] as const;

	if (data.matched) {
		lines.push("## Metrics", "", "| Metric | Value | Threshold |", "| --- | --- | --- |");
		for (const metric of metrics) {
			const value = data.report.summary[metric];
			const threshold = data.globalThresholds[metric];
			const thresholdStr = threshold !== undefined ? `${threshold}%` : "—";
			const icon = threshold !== undefined && value < threshold ? "❌" : "✅";
			lines.push(`| ${metric} | ${icon} ${value.toFixed(2)}% | ${thresholdStr} |`);
		}
		if (data.report.uncoveredLines) {
			lines.push("", "## Uncovered Lines", "", `\`${data.report.uncoveredLines}\``);
		}
		lines.push(
			"",
			"## Next steps",
			"",
			'- Use test({ action: "for_file" }) to find tests covering this file',
			"- Write tests targeting the uncovered lines",
		);
	} else {
		lines.push(
			"This file is not in the low-coverage list.",
			"",
			"Possible reasons:",
			"- File meets all coverage thresholds",
			"- File was not included in the coverage run",
			"- File path does not match any tracked source file",
			"",
			"## Project Coverage Totals",
			"",
			"| Metric | Value |",
			"| --- | --- |",
			`| statements | ${data.totals.statements.toFixed(2)}% |`,
			`| branches | ${data.totals.branches.toFixed(2)}% |`,
			`| functions | ${data.totals.functions.toFixed(2)}% |`,
			`| lines | ${data.totals.lines.toFixed(2)}% |`,
		);
	}

	if (data.relatedTestFiles.length > 0) {
		lines.push("", "## Tests Covering This File", "");
		for (const tf of data.relatedTestFiles) lines.push(`- \`${tf}\``);
	}

	return lines.join("\n");
};

export const FileCoverageAsMarkdown = Schema.transformOrFail(FileCoverageResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatFileCoverageMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "FileCoverageAsMarkdown is one-way.")),
});

export const fileCoverage = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				filePath: Schema.String,
				project: Schema.optional(Schema.String),
			}),
		),
	)
	.query(
		async ({ ctx, input }): Promise<FileCoverageResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const project = input.project ?? "default";
					const coverageOpt = yield* reader.getCoverage(project);
					if (Option.isNone(coverageOpt)) {
						return { dataAvailable: false as const, filePath: input.filePath };
					}
					const coverage = coverageOpt.value;
					const normalizedPath = input.filePath.replace(/^\.\//, "");
					const match =
						coverage.lowCoverage.find((f) => f.file === normalizedPath) ??
						coverage.lowCoverage.find((f) => f.file.endsWith(normalizedPath) || normalizedPath.endsWith(f.file));
					const relatedTestFiles = yield* reader.getTestsForFile(normalizedPath);
					if (match) {
						return {
							dataAvailable: true as const,
							matched: true as const,
							filePath: normalizedPath,
							report: match,
							globalThresholds: coverage.thresholds.global,
							relatedTestFiles,
						};
					}
					return {
						dataAvailable: true as const,
						matched: false as const,
						filePath: normalizedPath,
						totals: coverage.totals,
						relatedTestFiles,
					};
				}),
			),
	);
