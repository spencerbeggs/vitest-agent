/**
 * `test_coverage` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { CoverageReport, DataReader } from "@vitest-agent/sdk";
import { Effect, Option, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

const CoverageAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	project: Schema.String,
	coverage: CoverageReport,
}).annotations({ identifier: "TestCoverageAvailable" });

const CoverageAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false),
	project: Schema.String,
}).annotations({ identifier: "TestCoverageAbsent" });

export const TestCoverageResult = Schema.Union(CoverageAvailable, CoverageAbsent).annotations({
	identifier: "TestCoverageResult",
	title: "test_coverage result",
	description: "Per-project coverage report. Discriminate on `dataAvailable` for cold-start handling.",
});
export type TestCoverageResultType = Schema.Schema.Type<typeof TestCoverageResult>;

export const formatTestCoverageMarkdown = (data: TestCoverageResultType): string => {
	if (!data.dataAvailable) return "No coverage data available. Run tests with coverage enabled.";
	const lines: string[] = ["# Coverage Report", ""];
	const { totals, thresholds } = data.coverage;
	lines.push("## Totals", "", "| Metric | Value | Threshold |", "| --- | --- | --- |");
	const metrics = ["statements", "branches", "functions", "lines"] as const;
	for (const metric of metrics) {
		const value = totals[metric];
		const threshold = thresholds.global[metric];
		const thresholdStr = threshold !== undefined ? `${threshold}%` : "—";
		const icon = threshold !== undefined && value < threshold ? "❌" : "✅";
		lines.push(`| ${metric} | ${icon} ${value.toFixed(2)}% | ${thresholdStr} |`);
	}
	lines.push("");
	if (data.coverage.lowCoverage.length > 0) {
		lines.push("## Coverage Gaps", "", "Files below coverage threshold:", "");
		for (const fileCoverage of data.coverage.lowCoverage) {
			lines.push(`### \`${fileCoverage.file}\``, "", "| Metric | Value |", "| --- | --- |");
			for (const metric of metrics) {
				lines.push(`| ${metric} | ${fileCoverage.summary[metric].toFixed(2)}% |`);
			}
			if (fileCoverage.uncoveredLines) {
				lines.push(`| Uncovered lines | \`${fileCoverage.uncoveredLines}\` |`);
			}
			lines.push("");
		}
	} else {
		lines.push("✅ All files meet coverage thresholds.", "");
	}
	return lines.join("\n");
};

export const TestCoverageAsMarkdown = Schema.transformOrFail(TestCoverageResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatTestCoverageMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(new ParseResult.Forbidden(ast, text, "TestCoverageAsMarkdown is one-way.")),
});

export const testCoverage = publicProcedure
	.input(Schema.standardSchemaV1(Schema.Struct({ project: Schema.optional(Schema.String) })))
	.query(
		async ({ ctx, input }): Promise<TestCoverageResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const project = input.project ?? "default";
					const coverageOpt = yield* reader.getCoverage(project);
					if (Option.isNone(coverageOpt)) {
						return { dataAvailable: false as const, project };
					}
					return { dataAvailable: true as const, project, coverage: coverageOpt.value };
				}),
			),
	);
