/**
 * CLI show command — renders the latest cached run for a project
 * through the shared event-sourced renderer.
 *
 * Default format picks human when stdout is a TTY and NO_COLOR is
 * unset, otherwise agent. Override with --format.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { DataReader } from "vitest-agent-sdk";
import type { ShowFormat } from "../lib/format-show.js";
import { formatShow } from "../lib/format-show.js";

const formatOption = Options.withDefault(Options.choice("format", ["agent", "human", "json", "auto"]), "auto");
const projectOption = Options.optional(Options.text("project"));
const widthOption = Options.optional(Options.integer("width"));

const resolveAutoFormat = (): "agent" | "human" => {
	if (process.env.CI === "true") return "agent";
	if (process.stdout.isTTY !== true) return "agent";
	return "human";
};

const resolveFormat = (input: "agent" | "human" | "json" | "auto"): ShowFormat =>
	input === "auto" ? resolveAutoFormat() : input;

export const showCommand = Command.make(
	"show",
	{ format: formatOption, project: projectOption, width: widthOption },
	(opts) =>
		Effect.gen(function* () {
			const reader = yield* DataReader;

			const projectName = opts.project._tag === "Some" ? opts.project.value : "default";

			const reportOpt = yield* reader.getLatestRun(projectName);
			if (Option.isNone(reportOpt)) {
				yield* Effect.sync(() =>
					process.stdout.write(
						`No cached run for project ${projectName}. Run tests with the vitest-agent plugin enabled.\n`,
					),
				);
				return;
			}

			const format = resolveFormat(opts.format);
			const width = opts.width._tag === "Some" ? opts.width.value : undefined;
			const output = formatShow(reportOpt.value, format, width !== undefined ? { width } : {});
			yield* Effect.sync(() => process.stdout.write(`${output}\n`));
		}),
).pipe(Command.withDescription("Render the latest cached run through the agent or Ink human renderer"));
