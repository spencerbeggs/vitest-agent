import { Effect, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const testErrors = publicProcedure
	.input(
		Schema.standardSchemaV1(
			Schema.Struct({
				project: Schema.String,
				errorName: Schema.optional(Schema.String),
			}),
		),
	)
	.query(async ({ ctx, input }) => {
		return ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const errors = yield* reader.getErrors(input.project, input.errorName);

				if (errors.length === 0) {
					const scope = input.errorName ? ` matching \`${input.errorName}\`` : "";
					return `No errors found for project \`${input.project}\`${scope}.`;
				}

				const lines: string[] = [`# Test Errors — ${input.project}`, ""];

				for (const error of errors) {
					const name = error.name ?? "(unnamed)";
					lines.push(`## ${name}`);
					lines.push("");
					lines.push(`**Scope:** ${error.scope}`);

					if (error.testFullName) {
						lines.push(`**Test:** ${error.testFullName}`);
					}

					if (error.moduleFile) {
						lines.push(`**File:** \`${error.moduleFile}\``);
					}

					lines.push("");
					lines.push(`**Message:**`);
					lines.push(`> ${error.message.split("\n").join("\n> ")}`);

					if (error.diff) {
						lines.push("");
						lines.push("**Diff:**");
						lines.push("```diff");
						lines.push(error.diff.slice(0, 500));
						if (error.diff.length > 500) {
							lines.push("... (truncated)");
						}
						lines.push("```");
					}

					if (error.stack && !error.diff) {
						lines.push("");
						lines.push("**Stack:**");
						lines.push("```");
						lines.push(error.stack.slice(0, 500));
						if (error.stack.length > 500) {
							lines.push("... (truncated)");
						}
						lines.push("```");
					}

					lines.push("");
				}

				return lines.join("\n");
			}),
		);
	});
