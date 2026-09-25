// Union-rooted tool schemas on the wire.
//
// MCP needs a tool's input and output JSON Schemas rooted in an object, and
// Effect emits a top-level `Schema.Union` as a bare `anyOf`:
//
// - A union `parameters` schema on `Tool.make` dies the server at
//   registration (core decodes the input document against `ToolJson` with
//   `orDie`). The action-keyed tools therefore register as `Tool.dynamic`
//   with a raw JSON Schema — Effect's strict document for the union
//   (`additionalProperties: false` on every object node), rewritten by
//   `ToolInputSchema.objectRooted` to `{ type: "object", oneOf,
//   "x-discriminator" }` — and decode the union inside their own handler
//   through `decodeStrictUnion`. Core never re-annotates or strictly decodes a
//   dynamic tool, so the unknown-key report `McpToolkit.layer` gives every
//   other tool happens here instead.
// - An `anyOf`-rooted success document is dropped from `tools/list` by the
//   stateful revisions and served verbatim by `2026-07-28`, where strict
//   clients reject it. `objectRootedUnion` adds `type: "object"` beside the
//   `anyOf` through a no-op check, so `outputSchema` is served on every
//   revision (issue #489) while the Effect schema stays the same union.

import { ToolInputSchema } from "@effected/mcp";
import type { JsonSchema } from "effect";
import { Effect, Schema } from "effect";
import { McpSchema, Tool } from "effect/unstable/ai";
import { ToolRefusal } from "./_tool-refusal.js";

/** Always passes; contributes `type: "object"` to the node's JSON Schema. */
const objectRoot = Schema.makeFilter<unknown>(() => true, { toJsonSchema: () => ({ type: "object" }) });

/**
 * `schema` with `type: "object"` added at its JSON Schema root. Apply it
 * before `.annotate({ identifier })`: a check added after an identifier
 * starts a new, unnamed node. Every member must be an object shape.
 *
 * @internal
 */
export const objectRootedUnion = <S extends Schema.Top>(schema: S): S => schema.check(objectRoot) as S;

/**
 * The input JSON Schema a union-parameter tool is served with: Effect's
 * strict document for `parameters` (definitions attached as `$defs`), made
 * object-rooted.
 *
 * @internal
 */
export const unionInputJsonSchema = (parameters: Schema.Top): JsonSchema.JsonSchema => {
	const document = Schema.toJsonSchemaDocument(parameters, { onExcessProperty: "error" });
	return ToolInputSchema.objectRooted(
		Object.keys(document.definitions).length === 0
			? document.schema
			: { ...document.schema, $defs: document.definitions },
	);
};

/**
 * A `Tool.dynamic` served with {@link unionInputJsonSchema} of `parameters`.
 * Its handler receives the raw payload; wrap the typed handler in
 * {@link decodeStrictUnion}. Declare services with `.addDependency`. The
 * declared failures are `InvalidParams` (from the decode) and
 * `ToolRefusal` (a refusal the handler raises), both sent as `isError` text.
 *
 * @internal
 */
export const strictUnionTool = <const Name extends string, Success extends Schema.Constraint>(
	name: Name,
	options: {
		readonly description: string;
		readonly parameters: Schema.Top;
		readonly success: Success;
	},
) =>
	Tool.dynamic(name, {
		description: options.description,
		parameters: unionInputJsonSchema(options.parameters),
		success: options.success,
		failure: Schema.Union([McpSchema.InvalidParams, ToolRefusal]),
	});

/**
 * Wrap a typed handler for a {@link strictUnionTool}: name every unknown key
 * in the raw payload against the served schema, then decode `parameters`
 * with `onExcessProperty: "error"`. Either rejection fails with
 * `InvalidParams`, which reaches the agent as an `isError` result whose text
 * is the message.
 *
 * @internal
 */
export const decodeStrictUnion = <S extends Schema.Top, A, E, R>(
	tool: Tool.Any,
	parameters: S,
	handler: (params: S["Type"]) => Effect.Effect<A, E, R>,
): ((payload: unknown) => Effect.Effect<A, E | McpSchema.InvalidParams, R | S["DecodingServices"]>) => {
	const served = Tool.getJsonSchema(tool);
	const decode = Schema.decodeUnknownEffect(parameters);
	return (payload) =>
		Effect.suspend(() => {
			const raw = payload ?? {};
			const levels = ToolInputSchema.unknownKeys(raw, served);
			if (levels.length > 0) {
				return Effect.fail(new McpSchema.InvalidParams({ message: ToolInputSchema.formatUnknownKeys(levels) }));
			}
			return decode(raw, { onExcessProperty: "error" }).pipe(
				Effect.mapError(
					(error) =>
						new McpSchema.InvalidParams({ message: `Invalid parameters for tool '${tool.name}': ${error.message}` }),
				),
				Effect.flatMap(handler),
			);
		});
};
