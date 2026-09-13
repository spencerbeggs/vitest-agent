// `cache_health` MCP tool — Schema-driven implementation.
//
// Wraps the cache manifest in a `CacheHealthResult` Schema that
// captures both the present and absent cases. The text channel
// renders the same markdown the previous implementation produced;
// the structured payload now exposes `manifestPresent` plus the
// computed `ageMs` so agents can branch on freshness without parsing
// prose.

import { DataReader } from "@vitest-agent/engine";
import { CacheManifest } from "@vitest-agent/sdk";
import { Effect, Option, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/unstable/ai";
import { RenderText } from "../annotations.js";

const ManifestPresent = Schema.Struct({
	manifestPresent: Schema.Literal(true).annotate({
		description: "Discriminant — `true` when a cache manifest exists.",
	}),
	manifest: CacheManifest.annotate({
		description: "Full cache manifest content as written by the reporter.",
	}),
	ageMs: Schema.Finite.annotate({
		description: "Milliseconds since the manifest was last updated. Computed at query time, not stored.",
	}),
	stale: Schema.Boolean.annotate({
		description: "Convenience flag — `true` when `ageMs` exceeds 24 hours, otherwise `false`.",
	}),
}).annotate({ identifier: "CacheHealthPresent", title: "Cache manifest present" });

const ManifestAbsent = Schema.Struct({
	manifestPresent: Schema.Literal(false).annotate({
		description: "Discriminant — `false` when no manifest has been written yet (run tests to populate the cache).",
	}),
}).annotate({ identifier: "CacheHealthAbsent", title: "Cache manifest absent" });

/**
 * The `cache_health` tool's success payload.
 *
 * @public
 */
export const CacheHealthResult = Schema.Union([ManifestPresent, ManifestAbsent]).annotate({
	identifier: "CacheHealthResult",
	title: "cache_health result",
	description: "Cache health snapshot. Discriminate on `manifestPresent` to see whether the manifest exists.",
});
/**
 * The decoded {@link CacheHealthResult}.
 *
 * @public
 */
export type CacheHealthResultType = Schema.Schema.Type<typeof CacheHealthResult>;

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const iconForResult = (r: string | null): string => {
	if (r === "passed") return "✅";
	if (r === "failed") return "❌";
	if (r === "interrupted") return "⚠️";
	return "⬜";
};

export const formatCacheHealthMarkdown = (data: CacheHealthResultType): string => {
	const lines: string[] = ["# Cache Health", ""];

	if (data.manifestPresent === false) {
		lines.push("- ❌ **Manifest:** not found — run tests to populate the cache");
		return lines.join("\n");
	}

	const { manifest, ageMs, stale } = data;
	const ageHours = ageMs / (1000 * 60 * 60);

	lines.push("- ✅ **Manifest:** present");
	lines.push(`- ℹ️ **Projects:** ${manifest.projects.length}`);
	lines.push(`- ℹ️ **Cache directory:** \`${manifest.cacheDir}\``);
	lines.push(`- ℹ️ **Last updated:** ${manifest.updatedAt}`);

	if (stale) {
		lines.push(`- ⚠️ **Staleness:** cache is ${Math.round(ageHours)} hours old — consider re-running tests`);
	} else {
		lines.push(`- ✅ **Staleness:** cache is ${Math.round(ageHours * 60)} minutes old`);
	}

	lines.push("", "## Projects", "");
	for (const entry of manifest.projects) {
		const lastRun = entry.lastRun ? new Date(entry.lastRun).toLocaleString() : "never";
		lines.push(`- ${iconForResult(entry.lastResult)} **${entry.project}** — last run: ${lastRun}`);
	}
	return lines.join("\n");
};

export const CacheHealthAsMarkdown = CacheHealthResult.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transform((data) => formatCacheHealthMarkdown(data)),
		encode: SchemaGetter.forbidden(
			() => "CacheHealthAsMarkdown is one-way: markdown cannot be parsed back to CacheHealthResult.",
		),
	}),
);

/**
 * Handler for {@link cacheHealthTool}.
 *
 * @public
 */
export const handleCacheHealth = (): Effect.Effect<CacheHealthResultType, never, DataReader> =>
	Effect.gen(function* () {
		const reader = yield* DataReader;
		const manifestOpt = yield* reader.getManifest();
		if (Option.isNone(manifestOpt)) {
			return { manifestPresent: false as const };
		}
		const manifest = manifestOpt.value;
		const ageMs = Date.now() - new Date(manifest.updatedAt).getTime();
		return {
			manifestPresent: true as const,
			manifest,
			ageMs,
			stale: ageMs > STALE_AFTER_MS,
		};
	}).pipe(Effect.orDie);

/**
 * The Effect-native `cache_health` tool. No parameters (the default
 * `Tool.EmptyParams` serves as a strict empty object).
 *
 * @public
 */
export const cacheHealthTool = Tool.make("cache_health", {
	description:
		"Use when you suspect stale data and need manifest presence, project states, and staleness. Returns markdown in content[] and a typed JSON object in structuredContent ({ manifestPresent, manifest?, ageMs?, stale? }).",
	success: CacheHealthResult,
	dependencies: [DataReader],
})
	.annotate(Tool.Title, "Cache health")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true)
	.annotate(RenderText, (encoded) => formatCacheHealthMarkdown(encoded as CacheHealthResultType));
