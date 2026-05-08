import { Effect, Schema } from "effect";
import type { TestListEntry } from "vitest-agent-sdk";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testList = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.optional(Schema.String),
				state: Schema.optional(Schema.String),
				module: Schema.optional(Schema.String),
				limit: Schema.optional(Schema.Number),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const opts: { state?: string; module?: string; limit?: number } = {};
				if (input.state !== undefined) opts.state = input.state;
				if (input.module !== undefined) opts.module = input.module;
				if (input.limit !== undefined) opts.limit = input.limit;

				// When project is unspecified, enumerate every project that has a
				// recorded run and list tests from each project's latest run.
				const targets: ReadonlyArray<{ project: string }> = input.project
					? [{ project: input.project }]
					: yield* reader.getRunsByProject().pipe(Effect.map((rs) => rs.map((r) => ({ project: r.project }))));

				if (targets.length === 0) {
					return "No projects found. Run run_tests({}) to execute tests and populate the database.";
				}

				const groups: Array<{ project: string; tests: ReadonlyArray<TestListEntry> }> = [];
				let total = 0;
				for (const t of targets) {
					const tests = yield* reader.listTests(t.project, opts);
					if (tests.length > 0) {
						groups.push({ project: t.project, tests });
						total += tests.length;
					}
				}

				if (total === 0) {
					return "No tests found. Run run_tests({}) to execute tests and populate the database.";
				}

				const lines: string[] = ["## Tests", ""];
				for (const g of groups) {
					lines.push(`### ${g.project}`, "");
					lines.push("| ID | Full Name | State | Duration | Module | Classification |");
					lines.push("| --- | --- | --- | --- | --- | --- |");
					for (const t of g.tests) {
						const duration = t.duration !== null ? `${t.duration}ms` : "—";
						const classification = t.classification ?? "—";
						lines.push(`| ${t.id} | ${t.fullName} | ${t.state} | ${duration} | ${t.module} | ${classification} |`);
					}
					lines.push("");
				}

				return lines.join("\n").trimEnd();
			}),
		);
	});
