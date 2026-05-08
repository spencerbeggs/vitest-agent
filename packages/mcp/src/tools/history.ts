import { Effect, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testHistory = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.String,
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;

				const [history, flaky, persistent] = yield* Effect.all([
					reader.getHistory(input.project),
					reader.getFlaky(input.project),
					reader.getPersistentFailures(input.project),
				]);

				const hasData = history.tests.length > 0 || flaky.length > 0 || persistent.length > 0;

				if (!hasData) {
					return `No history data available for project \`${input.project}\`. Run tests first.`;
				}

				const lines: string[] = [`# Test History: ${input.project}`, ""];

				// Flaky tests
				if (flaky.length > 0) {
					lines.push("## Flaky Tests");
					lines.push("");
					lines.push("Tests with mixed pass/fail results across recent runs:");
					lines.push("");

					for (const test of flaky) {
						const total = test.passCount + test.failCount;
						const passRate = total > 0 ? ((test.passCount / total) * 100).toFixed(0) : "0";
						lines.push(`### ⚠️ ${test.fullName}`);
						lines.push("");
						lines.push(`- Pass rate: ${passRate}% (${test.passCount}/${total})`);
						lines.push(`- Last state: ${test.lastState}`);
						lines.push(`- Last run: ${new Date(test.lastTimestamp).toLocaleString()}`);
						lines.push("");
					}
				}

				// Persistent failures
				if (persistent.length > 0) {
					lines.push("## Persistent Failures");
					lines.push("");
					lines.push("Tests that have failed in consecutive runs:");
					lines.push("");

					for (const failure of persistent) {
						lines.push(`### ❌ ${failure.fullName}`);
						lines.push("");
						lines.push(`- Consecutive failures: ${failure.consecutiveFailures}`);
						lines.push(`- First failed: ${new Date(failure.firstFailedAt).toLocaleString()}`);
						lines.push(`- Last failed: ${new Date(failure.lastFailedAt).toLocaleString()}`);
						if (failure.lastErrorMessage) {
							lines.push(`- Last error: ${failure.lastErrorMessage}`);
						}
						lines.push("");
					}
				}

				// Run visualization for tracked tests
				const recoveredTests = history.tests.filter((t) => {
					const runs = t.runs;
					if (runs.length < 2) return false;
					const last = runs[runs.length - 1];
					const prev = runs[runs.length - 2];
					return last !== undefined && prev !== undefined && last.state === "passed" && prev.state === "failed";
				});

				if (recoveredTests.length > 0) {
					lines.push("## Recovered Tests");
					lines.push("");
					lines.push("Tests that previously failed but are now passing:");
					lines.push("");

					for (const test of recoveredTests) {
						const runViz = test.runs
							.slice(-10)
							.map((r) => (r.state === "passed" ? "P" : "F"))
							.join("");
						lines.push(`- ✅ **${test.fullName}** — recent runs: \`${runViz}\``);
					}
					lines.push("");
				}

				if (flaky.length === 0 && persistent.length === 0 && recoveredTests.length === 0) {
					lines.push("✅ No flaky, persistent, or recently recovered tests.");
					lines.push("");
				}

				lines.push(`_History updated: ${history.updatedAt}_`);

				return lines.join("\n");
			}),
		);
	});
