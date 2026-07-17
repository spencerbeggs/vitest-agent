/**
 * `configure` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const SettingsRowSchema = Schema.Struct({
	hash: Schema.String.annotate({
		description: "Stable SHA-1 of the captured Vitest settings; `test_runs.settings_hash` foreign key.",
	}),
	reporters: Schema.NullOr(Schema.String).annotate({
		description: "Comma-separated reporter list as resolved from the user's vitest config.",
	}),
	coverageEnabled: Schema.Boolean.annotate({ description: "Whether coverage was on for this run." }),
	coverageProvider: Schema.NullOr(Schema.String).annotate({
		description: "Coverage provider (`v8` or `istanbul`).",
	}),
	coverageThresholds: Schema.NullOr(Schema.String).annotate({
		description: "JSON-encoded threshold table when present; `null` when no thresholds were configured.",
	}),
	coverageTargets: Schema.NullOr(Schema.String).annotate({
		description: "JSON-encoded aspirational target table when present.",
	}),
	pool: Schema.NullOr(Schema.String).annotate({ description: "Vitest pool (`forks` / `threads` / `vmThreads`)." }),
	shard: Schema.NullOr(Schema.String).annotate({
		description: "Shard descriptor when running sharded (`1/4` form).",
	}),
	project: Schema.NullOr(Schema.String).annotate({ description: "Project name within a multi-project setup." }),
	environment: Schema.NullOr(Schema.String).annotate({ description: "Test environment (`node`, `jsdom`, etc.)." }),
	envVars: Schema.Record(Schema.String, Schema.String).annotate({
		description: "Captured CI / test env vars associated with this settings hash.",
	}),
	capturedAt: Schema.String.annotate({ description: "ISO-8601 timestamp the settings row was first written." }),
}).annotate({ identifier: "SettingsRowSchema", title: "Vitest settings snapshot" });

const SettingsFound = Schema.Struct({
	found: Schema.Literal(true).annotate({ description: "Discriminant — `true` when settings were located." }),
	source: Schema.Literals(["requested", "latest"]).annotate({
		description: "`requested` when the caller supplied `settingsHash`; `latest` when the most-recent row was returned.",
	}),
	settings: SettingsRowSchema,
}).annotate({ identifier: "ConfigureFound" });

const SettingsAbsent = Schema.Struct({
	found: Schema.Literal(false).annotate({ description: "Discriminant — `false` when no settings matched." }),
	source: Schema.Literals(["requested", "latest"]),
	requestedHash: Schema.optional(Schema.String).annotate({
		description: "Echo of the hash the caller passed; absent when the empty `latest` lookup found nothing.",
	}),
}).annotate({ identifier: "ConfigureAbsent" });

export const ConfigureResult = Schema.Union([SettingsFound, SettingsAbsent]).annotate({
	identifier: "ConfigureResult",
	title: "configure result",
	description: "Captured Vitest settings for a run, or an absence record when the lookup found nothing.",
});
export type ConfigureResultType = Schema.Schema.Type<typeof ConfigureResult>;

const formatSettings = (s: Schema.Schema.Type<typeof SettingsRowSchema>): string => {
	const lines: string[] = [`# Settings — \`${s.hash}\``, ""];
	lines.push(`**Captured:** ${s.capturedAt}`);
	if (s.project !== null) lines.push(`**Project:** ${s.project}`);
	if (s.environment !== null) lines.push(`**Environment:** ${s.environment}`);
	if (s.pool !== null) lines.push(`**Pool:** ${s.pool}`);
	if (s.shard !== null) lines.push(`**Shard:** ${s.shard}`);
	lines.push("", "## Coverage", `- **Enabled:** ${s.coverageEnabled ? "yes" : "no"}`);
	if (s.coverageProvider !== null) lines.push(`- **Provider:** ${s.coverageProvider}`);
	if (s.coverageThresholds !== null) lines.push(`- **Thresholds:** \`${s.coverageThresholds}\``);
	if (s.coverageTargets !== null) lines.push(`- **Targets:** \`${s.coverageTargets}\``);
	if (s.reporters !== null) lines.push("", "## Reporters", `\`${s.reporters}\``);
	const envKeys = Object.keys(s.envVars);
	if (envKeys.length > 0) {
		lines.push("", "## Environment Variables");
		for (const key of envKeys) lines.push(`- \`${key}\`: \`${s.envVars[key]}\``);
	}
	return lines.join("\n");
};

export const formatConfigureMarkdown = (data: ConfigureResultType): string => {
	if (data.found) return formatSettings(data.settings);
	if (data.source === "latest") {
		return [
			"# Configure",
			"",
			"No settings captured yet. Run tests first.",
			"",
			"Configuration is written automatically by `AgentPlugin` when tests run.",
		].join("\n");
	}
	return `No settings found for hash \`${data.requestedHash ?? "(unknown)"}\`.`;
};

export const ConfigureAsMarkdown = ConfigureResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatConfigureMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "ConfigureAsMarkdown is one-way: markdown cannot be parsed back to ConfigureResult.",
		),
	}),
);

export const configure = publicProcedure
	.input(Schema.toStandardSchemaV1(Schema.Struct({ settingsHash: Schema.optional(Schema.String) })))
	.query(
		async ({ ctx, input }): Promise<ConfigureResultType> =>
			ctx.runtime.runPromise(
				Effect.gen(function* () {
					const reader = yield* DataReader;
					if (input.settingsHash === undefined) {
						const latestOpt = yield* reader.getLatestSettings();
						return Option.isNone(latestOpt)
							? { found: false as const, source: "latest" as const }
							: { found: true as const, source: "latest" as const, settings: latestOpt.value };
					}
					const settingsOpt = yield* reader.getSettings(input.settingsHash);
					return Option.isNone(settingsOpt)
						? {
								found: false as const,
								source: "requested" as const,
								requestedHash: input.settingsHash,
							}
						: { found: true as const, source: "requested" as const, settings: settingsOpt.value };
				}),
			),
	);
