/**
 * CLI history command -- displays test failure history.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { HistoryRecord } from "vitest-agent-sdk";
import { DataReader } from "vitest-agent-sdk";
import { formatHistory } from "../lib/format-history.js";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

export const historyCommand = Command.make("history", { format: formatOption }, ({ format }) =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const manifestOpt = yield* reader.getManifest();
		if (Option.isNone(manifestOpt)) {
			yield* Effect.sync(() => process.stdout.write("No test results found. Run tests first.\n"));
			return;
		}

		const manifest = manifestOpt.value;
		const records: HistoryRecord[] = [];
		for (const entry of manifest.projects) {
			const project = entry.project;
			const history = yield* reader.getHistory(project);
			if (history.tests.length > 0) {
				records.push(history);
			}
		}

		if (format === "json") {
			yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(records, null, 2)}\n`));
		} else {
			const output = formatHistory(records);
			yield* Effect.sync(() => process.stdout.write(`${output}\n`));
		}
	}),
);
