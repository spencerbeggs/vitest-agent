/**
 * CLI trends command -- display coverage trend data.
 *
 * @packageDocumentation
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { ResolvedThresholds, TrendRecord } from "vitest-agent-sdk";
import { DataReader } from "vitest-agent-sdk";
import { formatTrends } from "../lib/format-trends.js";

const formatOption = Options.withDefault(Options.choice("format", ["markdown", "json"]), "markdown");

export const trendsCommand = Command.make("trends", { format: formatOption }, ({ format }) =>
	Effect.gen(function* () {
		const reader = yield* DataReader;

		const manifestOpt = yield* reader.getManifest();
		if (Option.isNone(manifestOpt)) {
			yield* Effect.sync(() => process.stdout.write("No test results found. Run tests first.\n"));
			return;
		}

		const manifest = manifestOpt.value;
		const projects: Array<{ project: string; trends: TrendRecord; targets?: ResolvedThresholds }> = [];

		for (const entry of manifest.projects) {
			const project = entry.project;
			const trendsOpt = yield* reader.getTrends(project).pipe(Effect.catchAll(() => Effect.succeed(Option.none())));

			if (Option.isSome(trendsOpt)) {
				const reportOpt = yield* reader
					.getLatestRun(project)
					.pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
				const targets = Option.isSome(reportOpt) ? reportOpt.value.coverage?.targets : undefined;

				projects.push({
					project: entry.project,
					trends: trendsOpt.value,
					...(targets
						? { targets: { global: targets.global, perFile: false as const, patterns: targets.patterns ?? [] } }
						: {}),
				});
			}
		}

		if (format === "json") {
			yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`));
		} else {
			const output = formatTrends(projects as Parameters<typeof formatTrends>[0]);
			yield* Effect.sync(() => process.stdout.write(`${output}\n`));
		}
	}),
);
