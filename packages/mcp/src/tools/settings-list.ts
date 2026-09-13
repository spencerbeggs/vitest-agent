// `settings_list` MCP tool — Schema-driven implementation.

import { DataReader } from "@vitest-agent/engine";
import { Effect, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const SettingsRow = Schema.Struct({
	hash: Schema.String.annotate({
		description: "Stable SHA-1 of the captured Vitest settings; FK target on test_runs.",
	}),
	capturedAt: Schema.String.annotate({ description: "ISO-8601 timestamp the settings row was first written." }),
}).annotate({ identifier: "SettingsListRow" });

/**
 * The `settings_list` tool's success payload.
 *
 * @public
 */
export const SettingsListResult = Schema.Struct({
	count: Schema.Number,
	settings: Schema.Array(SettingsRow).annotate({
		description: "Distinct captured settings hashes the reporter has written, newest first.",
	}),
}).annotate({
	identifier: "SettingsListResult",
	title: "settings_list result",
	description: "Roster of distinct Vitest settings hashes the reporter has captured.",
});
/**
 * The decoded {@link SettingsListResult}.
 *
 * @public
 */
export type SettingsListResultType = Schema.Schema.Type<typeof SettingsListResult>;

export const formatSettingsListMarkdown = (data: SettingsListResultType): string => {
	if (data.settings.length === 0) return "No settings found. Run tests first.";
	const lines: string[] = ["## Settings", "", "| Hash | Timestamp |", "| --- | --- |"];
	for (const s of data.settings) lines.push(`| ${s.hash} | ${s.capturedAt} |`);
	return lines.join("\n");
};

export const SettingsListAsMarkdown = SettingsListResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatSettingsListMarkdown(data)),
		encode: SchemaGetter.forbidden(() => "SettingsListAsMarkdown is one-way."),
	}),
);

/**
 * Handler for {@link settingsListTool}.
 *
 * @public
 */
export const handleSettingsList = (): Effect.Effect<SettingsListResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const settings = yield* reader.listSettings();
		return { count: settings.length, settings };
	}).pipe(Effect.orDie);

/**
 * The Effect-native `settings_list` tool. No parameters (the default
 * `Tool.EmptyParams` serves as a strict empty object).
 *
 * @public
 */
export const settingsListTool = Tool.make("settings_list", {
	description:
		"Use when you need every captured settings snapshot and its hash. Returns markdown in content[] and a typed JSON object in structuredContent ({ count, settings[] }).",
	success: SettingsListResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Settings list")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatSettingsListMarkdown(encoded as SettingsListResultType));
