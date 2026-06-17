/**
 * `cache_health` MCP tool — Schema-driven implementation.
 *
 * Wraps the cache manifest in a `CacheHealthResult` Schema that
 * captures both the present and absent cases. The text channel
 * renders the same markdown the previous implementation produced;
 * the structured payload now exposes `manifestPresent` plus the
 * computed `ageMs` so agents can branch on freshness without parsing
 * prose.
 *
 * @packageDocumentation
 */

import { CacheManifest, DataReader } from "@vitest-agent/sdk";
import { Effect, Option, ParseResult, Schema } from "effect";
import { publicProcedure } from "../context.js";

const ManifestPresent = Schema.Struct({
	manifestPresent: Schema.Literal(true).annotations({
		description: "Discriminant — `true` when a cache manifest exists.",
	}),
	manifest: CacheManifest.annotations({
		description: "Full cache manifest content as written by the reporter.",
	}),
	ageMs: Schema.Number.annotations({
		description: "Milliseconds since the manifest was last updated. Computed at query time, not stored.",
	}),
	stale: Schema.Boolean.annotations({
		description: "Convenience flag — `true` when `ageMs` exceeds 24 hours, otherwise `false`.",
	}),
}).annotations({ identifier: "CacheHealthPresent", title: "Cache manifest present" });

const ManifestAbsent = Schema.Struct({
	manifestPresent: Schema.Literal(false).annotations({
		description: "Discriminant — `false` when no manifest has been written yet (run tests to populate the cache).",
	}),
}).annotations({ identifier: "CacheHealthAbsent", title: "Cache manifest absent" });

export const CacheHealthResult = Schema.Union(ManifestPresent, ManifestAbsent).annotations({
	identifier: "CacheHealthResult",
	title: "cache_health result",
	description: "Cache health snapshot. Discriminate on `manifestPresent` to see whether the manifest exists.",
});
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

export const CacheHealthAsMarkdown = Schema.transformOrFail(CacheHealthResult, Schema.String, {
	strict: true,
	decode: (data) => ParseResult.succeed(formatCacheHealthMarkdown(data)),
	encode: (text, _options, ast) =>
		ParseResult.fail(
			new ParseResult.Forbidden(
				ast,
				text,
				"CacheHealthAsMarkdown is one-way: markdown cannot be parsed back to CacheHealthResult.",
			),
		),
});

export const cacheHealth = publicProcedure.query(
	async ({ ctx }): Promise<CacheHealthResultType> =>
		ctx.runtime.runPromise(
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
			}),
		),
);
