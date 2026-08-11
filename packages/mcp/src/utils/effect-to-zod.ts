/**
 * Bridge an Effect Schema to a zod schema by routing through JSON
 * Schema. Used at the MCP `registerTool` boundary so a tool can keep
 * Effect Schema as the canonical source of truth for its output shape
 * while the SDK still receives the zod instance it expects in the
 * `outputSchema` field.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { z } from "zod";

/**
 * Convert an Effect `Schema.Codec<A, I>` to a zod schema by
 * serializing it to JSON Schema (`Schema.toJsonSchemaDocument`) and ingesting the
 * result via zod 4's `z.fromJSONSchema`.
 *
 * Trade-offs:
 *   - Effect-Schema-only refinements (custom predicates, Brand types)
 *     erase to plain JSON Schema primitives during the round-trip,
 *     so the resulting zod schema does not enforce them. Tools that
 *     need refinement enforcement at the MCP boundary should declare
 *     zod directly.
 *   - `Schema.NullOr(...)` round-trips correctly via JSON Schema's
 *     `oneOf` / nullable representation that zod understands.
 *   - `z.fromJSONSchema` is marked experimental in zod 4. The bridge
 *     contains a smoke-test in the corresponding test file so an
 *     incompatible upgrade surfaces immediately instead of in
 *     production tool registrations.
 *
 * Implementation note: zod 4's `z.fromJSONSchema` does not resolve
 * `$ref` lookups into `$defs` — every `{ $ref: "#/$defs/X" }` it
 * encounters throws "Reference not found". Effect's `Schema.toJsonSchemaDocument`
 * emits a `$ref`-and-`$defs` representation whenever a Schema carries
 * an `identifier` annotation. The bridge therefore inlines every
 * `$ref` in the document before handing it to zod (recursive
 * substitution, then drop `$defs`). The schemas don't use
 * `Schema.suspend`, so the substitution is acyclic.
 *
 * Annotation lifting: Effect lowers a checked numeric schema
 * (`Schema.Finite`, `Schema.Int`) to `{ type, allOf: [{ description }] }`
 * rather than putting the annotation on the node itself, and
 * `z.fromJSONSchema` preserves that nesting verbatim. A tool's
 * `outputSchema` would then advertise no description for the field. The
 * bridge therefore lifts annotation-only `allOf` members onto their
 * parent before handing the document to zod. Only the JSON Schema
 * annotation vocabulary is lifted -- a member carrying any constraint
 * keyword (`pattern`, `minimum`, ...) stays put so validation semantics
 * are never changed.
 *
 * MCP SDK constraint: `outputSchema` must normalise to a Zod object
 * schema (`normalizeObjectSchema` returns `undefined` for unions, then
 * `safeParseAsync(undefined, ...)` crashes with "Cannot read properties
 * of undefined (reading '_zod')"). When the resulting zod schema is not
 * object-typed (e.g. came from `Schema.Union` of discriminated
 * variants), the bridge wraps it in a permissive `z.object({}).catchall(z.unknown())`
 * so the SDK accepts it. The structured content the tool emits still
 * conforms to the original Effect Schema; consumers just don't get a
 * rich JSON Schema for the union in the tool listing. Restructure the
 * source schema as a single `Schema.Struct` with a discriminator field
 * if the rich listing matters.
 */
export const effectToZodSchema = <A, I>(schema: Schema.Codec<A, I>): z.ZodTypeAny => {
	// v4 `toJsonSchemaDocument` returns `{ dialect, schema, definitions }`
	// rather than v3's bare JSON Schema. Shared subschemas live under
	// `definitions` and are referenced as `#/$defs/X`, so rebuild the
	// v3-shaped root the inliner expects: the root schema with `$defs`.
	const document = Schema.toJsonSchemaDocument(schema);
	const jsonSchema = { ...document.schema, $defs: document.definitions } as unknown as Record<string, unknown>;
	const inlined = inlineAllRefs(jsonSchema);
	const zodSchema = z.fromJSONSchema(inlined as never) as z.ZodTypeAny;
	if (isObjectLike(zodSchema)) return zodSchema;
	return z.object({}).catchall(z.unknown());
};

const isObjectLike = (schema: z.ZodTypeAny): boolean => {
	const def = (schema as { _zod?: { def?: { type?: string; shape?: unknown } } })._zod?.def;
	return def?.type === "object" || def?.shape !== undefined;
};

const REF_PREFIX = "#/$defs/";

/**
 * The JSON Schema annotation vocabulary -- keywords that describe a
 * schema without constraining what it accepts. Only these are safe to
 * hoist out of an `allOf` member onto the parent node.
 */
const ANNOTATION_KEYWORDS = new Set([
	"title",
	"description",
	"examples",
	"default",
	"deprecated",
	"readOnly",
	"writeOnly",
	"contentEncoding",
	"contentMediaType",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Hoist the annotation keywords out of every `allOf` member onto
 * `node`, leaving each member's constraint keywords exactly where they
 * were. A member reduced to nothing is dropped, and `allOf` disappears
 * once every member has been consumed.
 *
 * Keys already present on the node win -- a nested annotation never
 * overwrites a more specific one -- and the first member to supply a
 * given key wins among siblings.
 */
const liftAnnotations = (node: Record<string, unknown>): Record<string, unknown> => {
	const members = node.allOf;
	if (!Array.isArray(members)) return node;
	const kept: Array<unknown> = [];
	const lifted: Record<string, unknown> = {};
	for (const member of members) {
		if (!isPlainObject(member)) {
			kept.push(member);
			continue;
		}
		const constraints: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(member)) {
			if (!ANNOTATION_KEYWORDS.has(key)) constraints[key] = value;
			else if (!(key in node) && !(key in lifted)) lifted[key] = value;
		}
		if (Object.keys(constraints).length > 0) kept.push(constraints);
	}
	if (Object.keys(lifted).length === 0) return node;
	const out: Record<string, unknown> = { ...node, ...lifted };
	if (kept.length > 0) out.allOf = kept;
	else delete out.allOf;
	return out;
};

/**
 * Walk a JSON Schema tree and replace every `$ref: "#/$defs/X"` node
 * with the contents of `$defs.X`, recursively. The `$defs` table is
 * dropped from the returned root.
 */
const inlineAllRefs = (root: Record<string, unknown>): Record<string, unknown> => {
	const defs = (root.$defs ?? {}) as Record<string, Record<string, unknown>>;
	const visit = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(visit);
		if (value === null || typeof value !== "object") return value;
		const obj = value as Record<string, unknown>;
		if (typeof obj.$ref === "string" && obj.$ref.startsWith(REF_PREFIX)) {
			const defName = obj.$ref.slice(REF_PREFIX.length);
			const target = defs[defName];
			if (target !== undefined) return visit(target);
		}
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			if (k === "$defs") continue;
			out[k] = visit(v);
		}
		return liftAnnotations(out);
	};
	return visit(root) as Record<string, unknown>;
};
