import { Effect, Schema } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

export const projectList = publicProcedure.input(Schema.standardSchemaV1(Schema.Struct({}))).query(async ({ ctx }) => {
	return ctx.runtime.runPromise(
		Effect.gen(function* () {
			const reader = yield* DataReader;
			const projects = yield* reader.getRunsByProject();

			if (projects.length === 0) {
				return "No projects found. Run tests first.";
			}

			const lines: string[] = ["## Projects", ""];
			lines.push("| Project | Last Run | Result | Total | Passed | Failed | Skipped |");
			lines.push("| --- | --- | --- | --- | --- | --- | --- |");

			for (const p of projects) {
				const lastRun = p.lastRun ? p.lastRun.split("T")[0] : "\u2014";
				const result = p.lastResult ?? "\u2014";
				lines.push(`| ${p.project} | ${lastRun} | ${result} | ${p.total} | ${p.passed} | ${p.failed} | ${p.skipped} |`);
			}

			return lines.join("\n");
		}),
	);
});
