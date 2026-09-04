/**
 * `test_coverage` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import type { FileCoverageReport } from "@vitest-agent/sdk";
import { CoverageReport, DataReader } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const CoverageAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	project: Schema.String,
	coverage: CoverageReport,
}).annotate({ identifier: "TestCoverageAvailable" });

const CoverageAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false),
	project: Schema.String,
}).annotate({ identifier: "TestCoverageAbsent" });

export const TestCoverageResult = Schema.Union([CoverageAvailable, CoverageAbsent]).annotate({
	identifier: "TestCoverageResult",
	title: "test_coverage result",
	description: "Per-project coverage report. Discriminate on `dataAvailable` for cold-start handling.",
});
export type TestCoverageResultType = Schema.Schema.Type<typeof TestCoverageResult>;

const METRICS = ["statements", "branches", "functions", "lines"] as const;

/** @internal */
const renderFileCoverageTable = (fileCoverage: FileCoverageReport): string[] => {
	const rows: string[] = [`### \`${fileCoverage.file}\``, "", "| Metric | Value |", "| --- | --- |"];
	for (const metric of METRICS) {
		rows.push(`| ${metric} | ${fileCoverage.summary[metric].toFixed(2)}% |`);
	}
	if (fileCoverage.uncoveredLines) {
		rows.push(`| Uncovered lines | \`${fileCoverage.uncoveredLines}\` |`);
	}
	rows.push("");
	return rows;
};

export const formatTestCoverageMarkdown = (data: TestCoverageResultType): string => {
	if (!data.dataAvailable) return "No coverage data available. Run tests with coverage enabled.";
	const lines: string[] = ["# Coverage Report", ""];
	const { totals, thresholds, targets } = data.coverage;
	// Two distinct bars: `thresholds` is the enforced Vitest coverage.thresholds
	// (build-blocking); `targets` is the aspirational coverageTargets. Never
	// collapse the two into one "Threshold" column — that mislabel is issue #237.
	const headerCols = targets
		? "| Metric | Value | Enforced threshold | Target |"
		: "| Metric | Value | Enforced threshold |";
	const sepCols = targets ? "| --- | --- | --- | --- |" : "| --- | --- | --- |";
	lines.push("## Totals", "", headerCols, sepCols);
	for (const metric of METRICS) {
		const value = totals[metric];
		const threshold = thresholds.global[metric];
		const thresholdStr = threshold !== undefined ? `${threshold}%` : "—";
		const icon = threshold !== undefined && value < threshold ? "❌" : "✅";
		const targetStr = targets ? (targets.global[metric] !== undefined ? `${targets.global[metric]}%` : "—") : undefined;
		lines.push(
			`| ${metric} | ${icon} ${value.toFixed(2)}% | ${thresholdStr} |${targetStr !== undefined ? ` ${targetStr} |` : ""}`,
		);
	}
	lines.push("");
	if (data.coverage.lowCoverage.length > 0) {
		lines.push("## Coverage Gaps", "", "Files below the enforced threshold (build-blocking):", "");
		for (const fileCoverage of data.coverage.lowCoverage) {
			lines.push(...renderFileCoverageTable(fileCoverage));
		}
	} else {
		// True against the enforced thresholds specifically -- a file can
		// still be below the aspirational target and this line stays true.
		lines.push("✅ All files meet coverage thresholds.", "");
	}
	if (data.coverage.belowTarget && data.coverage.belowTarget.length > 0) {
		lines.push(
			"## Coverage Improvements Needed",
			"",
			"Files below the aspirational target (passing the enforced threshold):",
			"",
		);
		for (const fileCoverage of data.coverage.belowTarget) {
			lines.push(...renderFileCoverageTable(fileCoverage));
		}
	}
	return lines.join("\n");
};

export const TestCoverageAsMarkdown = TestCoverageResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestCoverageMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "TestCoverageAsMarkdown is one-way."),
	}),
);

export const testCoverage = publicProcedure
	.input(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.optional(Schema.String) })))
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
