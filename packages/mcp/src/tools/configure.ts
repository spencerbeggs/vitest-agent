// `configure` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { objectRootedUnion } from "./_union-schema.js";

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

/**
 * The `configure` tool's success payload.
 *
 * @public
 */
export const ConfigureResult = objectRootedUnion(Schema.Union([SettingsFound, SettingsAbsent])).annotate({
	identifier: "ConfigureResult",
	title: "configure result",
	description: "Captured Vitest settings for a run, or an absence record when the lookup found nothing.",
});
/**
 * The decoded {@link ConfigureResult}.
 *
 * @public
 */
export type ConfigureResultType = Schema.Schema.Type<typeof ConfigureResult>;

/**
 * The `configure` tool's parameters.
 *
 * @public
 */
export const ConfigureInput = Schema.Struct({
	settingsHash: Schema.optionalKey(Schema.String).annotate({
		description: "Settings hash from a manifest entry or test run",
	}),
});
/**
 * The decoded {@link ConfigureInput}.
 *
 * @public
 */
export type ConfigureInputType = Schema.Schema.Type<typeof ConfigureInput>;

/**
 * Handler for {@link configureTool}.
 *
 * @public
 */
export const handleConfigure = (input: ConfigureInputType): Effect.Effect<ConfigureResultType, never, DataReader> =>
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
	}).pipe(Effect.orDie);

/**
 * The Effect-native `configure` tool.
 *
 * @public
 */
export const configureTool = Tool.make("configure", {
	description:
		"Use when you need the captured Vitest settings for a test run. Returns a typed JSON object in structuredContent ({ found, source, settings?, requestedHash? }).",
	parameters: ConfigureInput,
	success: ConfigureResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Configure")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
