/**
 * CLI triage command -- emits the W3 orientation triage brief.
 *
 * Calls the shared formatTriageEffect generator, which the MCP
 * triage_brief tool also uses. The plugin's SessionStart hook runs
 * this and pipes the result into Claude Code's additionalContext.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { formatTriageEffect } from "@vitest-agent/sdk";
import { Effect } from "effect";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json", "silent"]), "markdown");
const projectOption = Options.optional(Options.text("project"));
const maxLinesOption = Options.optional(Options.integer("max-lines"));

export const triageCommand = Command.make(
	"triage",
	{ format: formatOption, project: projectOption, maxLines: maxLinesOption },
	(opts) =>
		Effect.gen(function* () {
			const md = yield* formatTriageEffect({
				...(opts.project._tag === "Some" && { project: opts.project.value }),
				...(opts.maxLines._tag === "Some" && { maxLines: opts.maxLines.value }),
			});

			if (opts.format === "silent") return;

			if (opts.format === "json") {
				yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ triage: md })}\n`));
				return;
			}

			yield* Effect.sync(() => process.stdout.write(md.length > 0 ? `${md}\n` : ""));
		}),
).pipe(Command.withDescription("Emit the W3 orientation triage brief for SessionStart"));
