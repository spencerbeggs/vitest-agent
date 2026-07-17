/**
 * `settings_list` MCP tool — Schema-driven implementation.
 *
 * @packageDocumentation
 */

import { DataReader } from "@vitest-agent/sdk";
import { Effect, Schema, SchemaGetter } from "effect";
import { publicProcedure } from "../context.js";

const SettingsRow = Schema.Struct({
	hash: Schema.String.annotate({
		description: "Stable SHA-1 of the captured Vitest settings; FK target on test_runs.",
	}),
	capturedAt: Schema.String.annotate({ description: "ISO-8601 timestamp the settings row was first written." }),
}).annotate({ identifier: "SettingsListRow" });

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

export const settingsList = publicProcedure.input(Schema.toStandardSchemaV1(Schema.Struct({}))).query(
	async ({ ctx }): Promise<SettingsListResultType> =>
		ctx.runtime.runPromise(
			Effect.gen(function* () {
				const reader = yield* DataReader;
				const settings = yield* reader.listSettings();
				return { count: settings.length, settings };
			}),
		),
);
