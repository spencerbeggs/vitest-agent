import { Effect, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const suiteList = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.optional(Schema.String),
				module: Schema.optional(Schema.String),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const opts: { module?: string } = {};
				if (input.module !== undefined) opts.module = input.module;

				// When project is unspecified, enumerate every project that has a
				// recorded run and list suites from each project's latest run.
				const targets: ReadonlyArray<{ project: string }> = input.project
					? [{ project: input.project }]
					: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));

				if (targets.length === 0) {
					return "No projects found. Run run_tests({}) to execute tests and populate the database.";
				}

				const groups: Array<{
					project: string;
					suites: ReadonlyArray<{ id: number; name: string; module: string; state: string; testCount: number }>;
				}> = [];
				let total = 0;
				for (const t of targets) {
					const suites = yield* reader.listSuites(t.project, opts);
					if (suites.length > 0) {
						groups.push({ project: t.project, suites });
						total += suites.length;
					}
				}

				if (total === 0) {
					return "No suites found. Run run_tests({}) to execute tests and populate the database.";
				}

				const lines: string[] = ["## Suites", ""];
				for (const g of groups) {
					lines.push(`### ${g.project}`, "");
					lines.push("| ID | Name | Module | State | Tests |");
					lines.push("| --- | --- | --- | --- | --- |");
					for (const s of g.suites) {
						lines.push(`| ${s.id} | ${s.name} | ${s.module} | ${s.state} | ${s.testCount} |`);
					}
					lines.push("");
				}

				return lines.join("\n").trimEnd();
			}),
		);
	});
