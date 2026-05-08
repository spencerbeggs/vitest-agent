import { Effect, Option, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testOverview = publicProcedure
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

				const [manifestOpt, runs] = yield* Effect.all([reader.getManifest(), reader.getRunsByProject()]);

				if (Option.isNone(manifestOpt) || runs.length === 0) {
					return "No test data available. Run tests first.";
				}

				let filteredRuns = runs;
				if (input.project !== undefined) {
					filteredRuns = runs.filter((r) => r.project === input.project);
					if (filteredRuns.length === 0) {
						return `No test data found for project \`${input.project}\`. Run tests first.`;
					}
				}

				const lines: string[] = ["# Test Overview", ""];

				const projectGroups = new Map<string, Array<(typeof filteredRuns)[number]>>();
				for (const run of filteredRuns) {
					const key = run.project;
					const group = projectGroups.get(key) ?? [];
					group.push(run);
					projectGroups.set(key, group);
				}

				for (const [projectName, projectRuns] of projectGroups) {
					lines.push(`## ${projectName}`);
					lines.push("");

					for (const run of projectRuns) {
						const label = run.project;
						const lastRun = run.lastRun ? new Date(run.lastRun).toLocaleString() : "never";
						const icon =
							run.lastResult === "passed"
								? "✅"
								: run.lastResult === "failed"
									? "❌"
									: run.lastResult === "interrupted"
										? "⚠️"
										: "⬜";

						lines.push(`### ${icon} ${label}`);
						lines.push("");
						lines.push(`| Metric | Count |`);
						lines.push(`| --- | --- |`);
						lines.push(`| Total | ${run.total} |`);
						lines.push(`| Passed | ${run.passed} |`);
						lines.push(`| Failed | ${run.failed} |`);
						lines.push(`| Skipped | ${run.skipped} |`);
						lines.push(`| Last run | ${lastRun} |`);
						lines.push("");
					}
				}

				return lines.join("\n");
			}),
		);
	});
