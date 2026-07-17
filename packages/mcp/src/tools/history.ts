/**
 * `test_history` MCP tool — Schema-driven implementation.
 *
 * The structured payload bundles the underlying `HistoryRecord` plus
 * the lighter `flaky` / `persistent` projections the UI uses, so an
 * agent doesn't need to recompute them from runs[].
 *
 * @packageDocumentation
 */

import { DataReader, HistoryRecord } from "@vitest-agent/sdk";
import { Effect, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const FlakyTestRow = Schema.Struct({
	fullName: Schema.String.annotate({ description: "Full hierarchical test name (`describe > it`)." }),
	modulePath: Schema.String.annotate({
		description: "Project-relative test module path -- disambiguates same-named tests across files.",
	}),
	project: Schema.String,
	passCount: Schema.Number.annotate({ description: "Number of passing runs in the recent window." }),
	failCount: Schema.Number.annotate({ description: "Number of failing runs in the recent window." }),
	lastState: Schema.Literals(["passed", "failed"]).annotate({ description: "State of the most recent run." }),
	lastTimestamp: Schema.String.annotate({ description: "ISO-8601 timestamp of the most recent run." }),
}).annotate({
	identifier: "FlakyTestRow",
	description: "A test that produced both passes and failures within the recent run window.",
});

const PersistentFailureRow = Schema.Struct({
	fullName: Schema.String,
	modulePath: Schema.String.annotate({
		description: "Project-relative test module path -- disambiguates same-named tests across files.",
	}),
	project: Schema.String,
	consecutiveFailures: Schema.Number.annotate({
		description: "Length of the current uninterrupted failure streak.",
	}),
	firstFailedAt: Schema.String.annotate({ description: "ISO-8601 timestamp of the first failure in this streak." }),
	lastFailedAt: Schema.String.annotate({ description: "ISO-8601 timestamp of the most recent failure." }),
	lastErrorMessage: Schema.NullOr(Schema.String).annotate({
		description: "Last error message reported by the failing test, when captured.",
	}),
}).annotate({
	identifier: "PersistentFailureRow",
	description: "A test that has failed in every recent run since `firstFailedAt`.",
});

const RecoveredTestRow = Schema.Struct({
	modulePath: Schema.String.annotate({
		description: "Project-relative test module path -- disambiguates same-named tests across files.",
	}),
	fullName: Schema.String,
	recentRuns: Schema.Array(Schema.Literals(["passed", "failed"])).annotate({
		description: "Last 10 run states for this test, oldest first.",
	}),
}).annotate({
	identifier: "RecoveredTestRow",
	description: "A test whose latest run passed after the previous one failed.",
});

export const TestHistoryResult = Schema.Struct({
	project: Schema.String.annotate({ description: "Workspace project key the history was computed for." }),
	hasData: Schema.Boolean.annotate({
		description: "`false` when no history rows exist for the project — agent should suggest running tests first.",
	}),
	history: HistoryRecord.annotate({ description: "Raw per-test history record (stored in `test_runs` joins)." }),
	flaky: Schema.Array(FlakyTestRow).annotate({ description: "Tests with mixed pass/fail outcomes recently." }),
	persistent: Schema.Array(PersistentFailureRow).annotate({ description: "Tests failing across consecutive runs." }),
	recovered: Schema.Array(RecoveredTestRow).annotate({
		description: "Tests that just transitioned from failing to passing in the last run.",
	}),
}).annotate({
	identifier: "TestHistoryResult",
	title: "test_history result",
	description: "Per-project flaky/persistent/recovered test classifications computed from `test_runs` history.",
});
export type TestHistoryResultType = Schema.Schema.Type<typeof TestHistoryResult>;

export const formatTestHistoryMarkdown = (data: TestHistoryResultType): string => {
	if (!data.hasData) return `No history data available for project \`${data.project}\`. Run tests first.`;

	const lines: string[] = [`# Test History: ${data.project}`, ""];

	if (data.flaky.length > 0) {
		lines.push("## Flaky Tests", "", "Tests with mixed pass/fail results across recent runs:", "");
		for (const test of data.flaky) {
			const total = test.passCount + test.failCount;
			const passRate = total > 0 ? ((test.passCount / total) * 100).toFixed(0) : "0";
			lines.push(
				`### ⚠️ ${test.fullName}`,
				"",
				`- Module: \`${test.modulePath}\``,
				`- Pass rate: ${passRate}% (${test.passCount}/${total})`,
				`- Last state: ${test.lastState}`,
				`- Last run: ${new Date(test.lastTimestamp).toLocaleString()}`,
				"",
			);
		}
	}

	if (data.persistent.length > 0) {
		lines.push("## Persistent Failures", "", "Tests that have failed in consecutive runs:", "");
		for (const failure of data.persistent) {
			lines.push(
				`### ❌ ${failure.fullName}`,
				"",
				`- Module: \`${failure.modulePath}\``,
				`- Consecutive failures: ${failure.consecutiveFailures}`,
				`- First failed: ${new Date(failure.firstFailedAt).toLocaleString()}`,
				`- Last failed: ${new Date(failure.lastFailedAt).toLocaleString()}`,
			);
			if (failure.lastErrorMessage !== null) lines.push(`- Last error: ${failure.lastErrorMessage}`);
			lines.push("");
		}
	}

	if (data.recovered.length > 0) {
		lines.push("## Recovered Tests", "", "Tests that previously failed but are now passing:", "");
		for (const test of data.recovered) {
			const runViz = test.recentRuns.map((s) => (s === "passed" ? "P" : "F")).join("");
			lines.push(`- ✅ **${test.fullName}** (${test.modulePath}) — recent runs: \`${runViz}\``);
		}
		lines.push("");
	}

	if (data.flaky.length === 0 && data.persistent.length === 0 && data.recovered.length === 0) {
		lines.push("✅ No flaky, persistent, or recently recovered tests.", "");
	}

	lines.push(`_History updated: ${data.history.updatedAt}_`);
	return lines.join("\n");
};

export const TestHistoryAsMarkdown = TestHistoryResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatTestHistoryMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "TestHistoryAsMarkdown is one-way: markdown cannot be parsed back to TestHistoryResult.",
		),
	}),
);

export const testHistory = publicProcedure
	.input(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String })))
	.query(
		async ({ ctx, input }): Promise<TestHistoryResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					const [history, flaky, persistent] = yield* Effect.all([
						reader.getHistory(input.project),
						reader.getFlaky(input.project),
						reader.getPersistentFailures(input.project),
					]);

					// t.runs is ordered most-recent-first (see classifyTest's documented
					// "priorRuns" convention), so the current/most recent run is
					// runs[0] and the one before it is runs[1].
					const recovered = history.tests
						.filter((t) => {
							const runs = t.runs;
							if (runs.length < 2) return false;
							const mostRecent = runs[0];
							const previous = runs[1];
							return (
								mostRecent !== undefined &&
								previous !== undefined &&
								mostRecent.state === "passed" &&
								previous.state === "failed"
							);
						})
						.map((t) => ({
							modulePath: t.modulePath,
							fullName: t.fullName,
							recentRuns: t.runs
								.slice(0, 10)
								.reverse()
								.map((r) => r.state),
						}));

					const hasData = history.tests.length > 0 || flaky.length > 0 || persistent.length > 0;
					return {
						project: input.project,
						hasData,
						history,
						flaky,
						persistent,
						recovered,
					};
				}),
			),
	);
