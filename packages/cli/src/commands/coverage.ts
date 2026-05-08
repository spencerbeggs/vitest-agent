/**
 * CLI coverage command -- displays coverage gap analysis.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { AgentReport } from "vitest-agent-sdk";
import { DataReader } from "vitest-agent-sdk";
import { formatCoverage } from "../lib/format-coverage.js";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

export const coverageCommand = Command.make("coverage", { format: formatOption }, ({ format }) =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const manifestOpt = yield* reader.getManifest();
		if (Option.isNone(manifestOpt)) {
			yield* Effect.sync(() => process.stdout.write("No test results found.\n"));
			return;
		}

		const manifest = manifestOpt.value;
		const reportEntries: Array<{ project: string; report: AgentReport }> = [];

		for (const entry of manifest.projects) {
			const project = entry.project;
			const reportOpt = yield* reader.getLatestRun(project);
			if (Option.isSome(reportOpt)) {
				reportEntries.push({ project: entry.project, report: reportOpt.value });
			}
		}

		if (format === "json") {
			yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(reportEntries, null, 2)}\n`));
		} else {
			const output = formatCoverage(reportEntries);
			yield* Effect.sync(() => process.stdout.write(`${output}\n`));
		}
	}),
);
