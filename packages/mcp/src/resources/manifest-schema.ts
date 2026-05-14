// packages/mcp/src/resources/manifest-schema.ts
import { Schema } from "effect";

const RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * MCP 2025-11-25 resource annotations. Both sub-fields are optional so a
 * partially-annotated manifest decodes cleanly during an editorial pass.
 *
 * `audience` is the set of client roles a resource is relevant to; today
 * only `assistant` is meaningful for the vitest-agent MCP server.
 * `priority` is a float in [0, 1] that lets a client rank or filter
 * results before pulling content into context. See the editorial guide
 * in `docs/superpowers/specs/2.0-resource-annotations.md` for the
 * priority bands per content type.
 */
export const ResourceAnnotations = Schema.Struct({
	audience: Schema.optional(Schema.Array(Schema.Literal("user", "assistant"))),
	priority: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
});

export type ResourceAnnotations = Schema.Schema.Type<typeof ResourceAnnotations>;

export const ManifestPage = Schema.Struct({
	path: Schema.String.pipe(Schema.pattern(RELATIVE_PATH)),
	title: Schema.NonEmptyString,
	description: Schema.NonEmptyString,
	annotations: Schema.optional(ResourceAnnotations),
});

export const UpstreamManifest = Schema.Struct({
	tag: Schema.NonEmptyString,
	commitSha: Schema.NonEmptyString,
	capturedAt: Schema.NonEmptyString,
	source: Schema.NonEmptyString,
	pages: Schema.optional(Schema.Array(ManifestPage)),
});

export type ManifestPage = Schema.Schema.Type<typeof ManifestPage>;
export type UpstreamManifest = Schema.Schema.Type<typeof UpstreamManifest>;

export const decodeUpstreamManifest = Schema.decodeUnknown(UpstreamManifest);
export const encodeUpstreamManifest = Schema.encodeUnknown(UpstreamManifest);

// ── Patterns library (_meta.json) ────────────────────────────────────────────
//
// The patterns library is authored inside this repo (not vendored), so its
// schema is a sibling of ManifestPage rather than reused. Annotations carry
// the same shape so consumers see one annotation contract regardless of
// which URI scheme produced the resource.

const SLUG_PATTERN = /^[A-Za-z0-9._-]+(?:[/-][A-Za-z0-9._-]+)*$/;

export const PatternEntry = Schema.Struct({
	slug: Schema.String.pipe(Schema.pattern(SLUG_PATTERN)),
	title: Schema.NonEmptyString,
	summary: Schema.NonEmptyString,
	annotations: Schema.optional(ResourceAnnotations),
});

export const PatternsManifest = Schema.Struct({
	patterns: Schema.Array(PatternEntry),
});

export type PatternEntry = Schema.Schema.Type<typeof PatternEntry>;
export type PatternsManifest = Schema.Schema.Type<typeof PatternsManifest>;

export const decodePatternsManifest = Schema.decodeUnknown(PatternsManifest);
