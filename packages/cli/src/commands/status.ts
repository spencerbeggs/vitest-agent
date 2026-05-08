/**
 * CLI status command -- displays test status from cached results.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { AgentReport } from "vitest-agent-sdk";
import { DataReader } from "vitest-agent-sdk";
import { formatStatus } from "../lib/format-status.js";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

export const statusCommand = Command.make("status", { format: formatOption }, ({ format }) =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const manifestOpt = yield* reader.getManifest();
		if (Option.isNone(manifestOpt)) {
			yield* Effect.sync(() => process.stdout.write("No test results found. Run tests first.\n"));
			return;
		}

		const manifest = manifestOpt.value;

		// Load failing reports
		const reports = new Map<string, AgentReport>();
		for (const entry of manifest.projects) {
			if (entry.lastResult === "failed") {
				const project = entry.project;
				const reportOpt = yield* reader.getLatestRun(project);
				if (Option.isSome(reportOpt)) {
					reports.set(entry.project, reportOpt.value);
				}
			}
		}

		if (format === "json") {
			const data = {
				manifest,
				reports: Object.fromEntries(reports.entries()),
			};
			yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`));
		} else {
			const output = formatStatus(manifest, reports);
			yield* Effect.sync(() => process.stdout.write(`${output}\n`));
		}
	}),
);
