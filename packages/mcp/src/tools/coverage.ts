// `test_coverage` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { CoverageReport } from "@vitest-agent/sdk";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

const CoverageAvailable = Schema.Struct({
	dataAvailable: Schema.Literal(true),
	project: Schema.String,
	coverage: CoverageReport,
}).annotate({ identifier: "TestCoverageAvailable" });

const CoverageAbsent = Schema.Struct({
	dataAvailable: Schema.Literal(false),
	project: Schema.String,
}).annotate({ identifier: "TestCoverageAbsent" });

/**
 * The `test_coverage` tool's success payload.
 *
 * @public
 */
export const TestCoverageResult = Schema.Union([CoverageAvailable, CoverageAbsent]).annotate({
	identifier: "TestCoverageResult",
	title: "test_coverage result",
	description: "Per-project coverage report. Discriminate on `dataAvailable` for cold-start handling.",
});
/**
 * The decoded {@link TestCoverageResult}.
 *
 * @public
 */
export type TestCoverageResultType = Schema.Schema.Type<typeof TestCoverageResult>;

/**
 * The `test_coverage` tool's parameters.
 *
 * @public
 */
export const TestCoverageInput = Schema.Struct({
	project: Schema.optionalKey(Schema.String).annotate({ description: "Project name" }),
});
/**
 * The decoded {@link TestCoverageInput}.
 *
 * @public
 */
export type TestCoverageInputType = Schema.Schema.Type<typeof TestCoverageInput>;

/**
 * Handler for {@link testCoverageTool}.
 *
 * @public
 */
export const handleTestCoverage = (
	input: TestCoverageInputType,
): Effect.Effect<TestCoverageResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const project = input.project ?? "default";
		const coverageOpt = yield* reader.getCoverage(project);
		if (Option.isNone(coverageOpt)) {
			return { dataAvailable: false as const, project };
		}
		return { dataAvailable: true as const, project, coverage: coverageOpt.value };
	}).pipe(Effect.orDie);

/**
 * The Effect-native `test_coverage` tool.
 *
 * @public
 */
export const testCoverageTool = Tool.make("test_coverage", {
	description:
		"Use when coverage drops and you need per-metric gap analysis against thresholds and targets. Returns a typed JSON object in structuredContent ({ dataAvailable, project, coverage } or absent variant).",
	parameters: TestCoverageInput,
	success: TestCoverageResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Test coverage")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
