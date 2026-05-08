import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testGet = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				fullName: Schema.String,
				project: Schema.optional(Schema.String),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const project = input.project ?? "default";

				// Direct indexed lookup by fullName
				const testOpt = yield* reader.getTestByFullName(project, input.fullName);

				if (Option.isNone(testOpt)) {
					return `Test not found: \`${input.fullName}\`\n\nUse test_list to discover available tests (format: "Suite > test name").`;
				}
				const test = testOpt.value;

				const lines: string[] = [`# Test: ${test.fullName}`, ""];

				// Basic info
				lines.push("## Details", "");
				lines.push("| Field | Value |");
				lines.push("| --- | --- |");
				lines.push(`| State | ${test.state} |`);
				lines.push(`| Duration | ${test.duration !== null ? `${test.duration}ms` : "\u2014"} |`);
				lines.push(`| Module | \`${test.module}\` |`);
				lines.push(`| Classification | ${test.classification ?? "\u2014"} |`);
				lines.push("");

				// Errors for this test
				const errors = yield* reader.getErrors(project);
				const testErrors = errors.filter((e) => e.testFullName === input.fullName);

				if (testErrors.length > 0) {
					lines.push("## Errors", "");
					for (const err of testErrors) {
						lines.push(`**${err.name ?? "(unnamed)"}**`);
						lines.push(`> ${err.message.split("\n").join("\n> ")}`);
						if (err.diff) {
							lines.push("");
							lines.push("```diff");
							lines.push(err.diff.slice(0, 1000));
							if (err.diff.length > 1000) {
								lines.push(`... (truncated, ${err.diff.length} chars total)`);
							}
							lines.push("```");
						}
						if (err.stack && !err.diff) {
							lines.push("");
							lines.push("```");
							lines.push(err.stack.slice(0, 1000));
							if (err.stack.length > 1000) {
								lines.push(`... (truncated, ${err.stack.length} chars total)`);
							}
							lines.push("```");
						}
						lines.push("");
					}
				}

				// History for this test
				const history = yield* reader.getHistory(project);
				const testHistory = history.tests.find((t) => t.fullName === input.fullName);

				if (testHistory && testHistory.runs.length > 0) {
					lines.push("## Run History", "");
					const runs = testHistory.runs;
					const viz = runs
						.map((r: { state: string }) => (r.state === "passed" ? "P" : r.state === "failed" ? "F" : "S"))
						.join("");
					const passCount = runs.filter((r: { state: string }) => r.state === "passed").length;
					const failCount = runs.filter((r: { state: string }) => r.state === "failed").length;
					lines.push(`Pass rate: ${passCount}/${runs.length} (${Math.round((passCount / runs.length) * 100)}%)`);
					lines.push(`Recent runs: \`${viz}\` (P=passed F=failed S=skipped, newest last)`);
					if (failCount > 0 && passCount > 0) {
						lines.push("Pattern: **flaky** (mixed pass/fail)");
					} else if (failCount > 0) {
						lines.push(`Pattern: **persistent failure** (${failCount} consecutive)`);
					}
					lines.push("");
				}

				// Suggest next actions
				if (test.state === "failed") {
					lines.push("## Next steps", "");
					lines.push(`- Re-run: run_tests({ files: ["${test.module}"] })`);
					lines.push("- Use test_for_file to find related tests");
					lines.push("- Use note_create to record debugging findings");
				}

				return lines.join("\n");
			}),
		);
	});
