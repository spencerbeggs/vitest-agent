import { Effect, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const moduleList = publicProcedure
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

				// When project is unspecified, enumerate every project that has a
				// recorded run and list modules from each project's latest run.
				// In multi-project Vitest configs the historical default of
				// "default" matched no projects and the tool returned empty.
				const targets: ReadonlyArray<{ project: string }> = input.project
					? [{ project: input.project }]
					: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));

				if (targets.length === 0) {
					return "No projects found. Run run_tests({}) to execute tests and populate the database.";
				}

				const groups: Array<{ project: string; modules: ReadonlyArray<unknown> }> = [];
				let total = 0;
				for (const t of targets) {
					const modules = yield* reader.listModules(t.project);
					if (modules.length > 0) {
						groups.push({ project: t.project, modules });
						total += modules.length;
					}
				}

				if (total === 0) {
					return "No modules found. Run run_tests({}) to execute tests and populate the database.";
				}

				const lines: string[] = ["## Modules", ""];
				for (const g of groups) {
					lines.push(`### ${g.project}`, "");
					lines.push("| ID | File | State | Tests | Duration |");
					lines.push("| --- | --- | --- | --- | --- |");
					for (const m of g.modules as Array<{
						id: number;
						file: string;
						state: string;
						testCount: number;
						duration: number | null;
					}>) {
						const duration = m.duration !== null ? `${m.duration}ms` : "—";
						lines.push(`| ${m.id} | ${m.file} | ${m.state} | ${m.testCount} | ${duration} |`);
					}
					lines.push("");
				}

				return lines.join("\n").trimEnd();
			}),
		);
	});
