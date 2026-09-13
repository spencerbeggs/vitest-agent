// Strict toolkit registration for the Effect-native MCP server.
//
// `McpServer.toolkit` decodes tool arguments with Effect's default
// `onExcessProperty: "ignore"`, so an unknown key is silently stripped —
// a misspelled filter runs a *wider* query while reporting success
// (issues #200 / #243). This module registers each tool over the public
// `McpServer.McpServer.addTool` instead and:
//
// 1. serves the tool's JSON Schema with `additionalProperties: false` on
//    every object node (and a top-level `action` / `kind` union rewritten
//    to `oneOf` + `x-discriminator`);
// 2. walks the raw payload against that served schema before decoding and
//    fails with `InvalidParams` naming the unknown key(s) and the accepted
//    params, at every object level;
// 3. renders the dual channel — `structuredContent` = the encoded result,
//    `content[0].text` = the tool's `RenderText` markdown or the JSON;
// 4. maps a declared, `Error`-shaped failure to `{ isError: true,
//    content: [{ text: error.message }] }` exactly as Effect's own
//    `registerToolkit` does, and every OTHER failure or defect to the
//    `UnexpectedToolError` envelope as `structuredContent` with
//    `isError: true`, so an in-boundary crash comes back in the same
//    structured shape as every other tool error;
// 5. inlines a `$ref` root (what an `identifier` annotation produces)
//    before the object checks, so identified schemas register and list.
//
// Adapted from Effect's own `registerToolkit`
// (`effect/unstable/ai/McpServer.ts`, rc.115).

import { Cause, Context, Effect, Layer, Option, Result, Schema, Sink, Stream } from "effect";
import type { Toolkit } from "effect/unstable/ai";
import { AiError, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { RenderText } from "./annotations.js";
import { buildUnexpectedToolErrorEnvelope } from "./utils/tool-error-envelope.js";

type JsonObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Top-level discriminants a union of parameter shapes may dispatch on. */
const DISCRIMINANT_KEYS = ["action", "kind"] as const;

/** Length cap for every echoed unknown key, so a hostile payload cannot balloon the error. */
const ECHO_LIMIT = 200;

const truncate = (value: string): string => (value.length > ECHO_LIMIT ? `${value.slice(0, ECHO_LIMIT)}…` : value);

const literalValues = (node: unknown): ReadonlyArray<unknown> | undefined => {
	if (!isPlainObject(node)) return undefined;
	if (Array.isArray(node.enum)) return node.enum;
	if ("const" in node) return [node.const];
	return undefined;
};

/**
 * The discriminant every member of a union shares as a literal-valued
 * property, or `undefined` when the members do not form such a union.
 */
const findDiscriminant = (members: ReadonlyArray<unknown>): (typeof DISCRIMINANT_KEYS)[number] | undefined => {
	if (members.length === 0) return undefined;
	for (const key of DISCRIMINANT_KEYS) {
		const shared = members.every((member) => {
			if (!isPlainObject(member) || !isPlainObject(member.properties)) return false;
			return literalValues(member.properties[key]) !== undefined;
		});
		if (shared) return key;
	}
	return undefined;
};

const REF_PREFIX = "#/$defs/";

const lookupRef = (ref: unknown, root: JsonObject): JsonObject | undefined => {
	if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX)) return undefined;
	const defs = root.$defs;
	if (!isPlainObject(defs)) return undefined;
	const target = defs[ref.slice(REF_PREFIX.length)];
	return isPlainObject(target) ? target : undefined;
};

/**
 * Replace a `$ref` node with its `$defs` target merged under the node's
 * own keywords (the node's keys win). Follows chained refs; gives up on a
 * cycle or a dangling ref and returns the node as-is.
 */
const inlineRef = (node: JsonObject, root: JsonObject, seen: ReadonlySet<unknown> = new Set()): JsonObject => {
	const target = lookupRef(node.$ref, root);
	if (target === undefined || seen.has(node.$ref)) return node;
	const { $ref, ...rest } = node;
	return inlineRef({ ...target, ...rest }, root, new Set([...seen, $ref]));
};

/**
 * A schema whose root (or whose top-level union members) is a `$ref` —
 * what Effect emits for any schema carrying an `identifier` annotation —
 * is inlined so the object / discriminant checks below see the real
 * shape. `$defs` is kept for any nested references.
 *
 * @internal
 */
export const inlineRootRefs = (schema: JsonObject): JsonObject => {
	const root = inlineRef(schema, schema);
	const combinator = Array.isArray(root.anyOf) ? "anyOf" : Array.isArray(root.oneOf) ? "oneOf" : undefined;
	if (combinator === undefined) return root;
	const members = (root[combinator] as ReadonlyArray<unknown>).map((member) =>
		isPlainObject(member) ? inlineRef(member, schema) : member,
	);
	return { ...root, [combinator]: members };
};

/**
 * Deep-copy `schema`, setting `additionalProperties: false` on every
 * object node that declares `properties` (or is a bare object with no
 * combinator), and rewriting a top-level union of discriminated object
 * shapes to `{ type: "object", oneOf, "x-discriminator" }` so the served
 * schema still satisfies MCP's object-root requirement.
 *
 * @internal
 */
export const strictifyJsonSchema = (schema: JsonObject): JsonObject => {
	const visit = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(visit);
		if (!isPlainObject(node)) return node;
		const out: JsonObject = {};
		for (const [key, value] of Object.entries(node)) {
			switch (key) {
				case "properties":
				case "$defs":
				case "definitions":
					out[key] = isPlainObject(value)
						? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]))
						: value;
					break;
				case "items":
				case "prefixItems":
				case "anyOf":
				case "oneOf":
				case "allOf":
				case "not":
					out[key] = visit(value);
					break;
				case "additionalProperties":
					out[key] = isPlainObject(value) ? visit(value) : value;
					break;
				default:
					out[key] = value;
			}
		}
		const hasCombinator = Array.isArray(out.anyOf) || Array.isArray(out.oneOf) || Array.isArray(out.allOf);
		const isObjectNode = out.type === "object" || isPlainObject(out.properties);
		if (isObjectNode && !hasCombinator && !isPlainObject(out.additionalProperties)) {
			out.additionalProperties = false;
		}
		return out;
	};
	const strict = visit(inlineRootRefs(schema)) as JsonObject;
	const members = strict.anyOf ?? strict.oneOf;
	if (Array.isArray(members) && strict.type === undefined) {
		const discriminant = findDiscriminant(members);
		if (discriminant !== undefined) {
			const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = strict;
			return { type: "object", ...rest, oneOf: members, "x-discriminator": discriminant };
		}
	}
	return strict;
};

interface UnknownKeysAtLevel {
	readonly path: ReadonlyArray<string>;
	readonly unknown: ReadonlyArray<string>;
	readonly accepted: ReadonlyArray<string>;
}

const resolveRef = (node: JsonObject, root: JsonObject): JsonObject => lookupRef(node.$ref, root) ?? node;

/** Pick the union member a payload object matches, or `undefined` when none does unambiguously. */
const selectMember = (members: ReadonlyArray<unknown>, value: JsonObject, root: JsonObject): JsonObject | undefined => {
	const resolved = members.map((m) => (isPlainObject(m) ? resolveRef(m, root) : m));
	const discriminant = findDiscriminant(resolved);
	if (discriminant !== undefined) {
		const actual = value[discriminant];
		return resolved.find((member) => {
			if (!isPlainObject(member) || !isPlainObject(member.properties)) return false;
			return literalValues(member.properties[discriminant])?.includes(actual) ?? false;
		}) as JsonObject | undefined;
	}
	const objectMembers = resolved.filter((m): m is JsonObject => isPlainObject(m) && isPlainObject(m.properties));
	return objectMembers.length === 1 ? objectMembers[0] : undefined;
};

/**
 * Walk `value` against `schema`, collecting — at every object level — the
 * keys the payload carries that the schema does not declare.
 *
 * @internal
 */
export const collectUnknownKeys = (value: unknown, schema: JsonObject): ReadonlyArray<UnknownKeysAtLevel> => {
	const out: Array<UnknownKeysAtLevel> = [];
	const walk = (current: unknown, rawNode: unknown, path: ReadonlyArray<string>): void => {
		if (!isPlainObject(rawNode)) return;
		const node = resolveRef(rawNode, schema);

		if (Array.isArray(node.allOf)) {
			const merged: JsonObject = {};
			for (const member of node.allOf) {
				const resolvedMember = isPlainObject(member) ? resolveRef(member, schema) : member;
				if (isPlainObject(resolvedMember) && isPlainObject(resolvedMember.properties)) {
					Object.assign(merged, resolvedMember.properties);
				}
			}
			if (Object.keys(merged).length > 0) {
				walk(
					current,
					{
						...node,
						allOf: undefined,
						properties: { ...merged, ...(isPlainObject(node.properties) ? node.properties : {}) },
					},
					path,
				);
				return;
			}
		}

		if (isPlainObject(node.properties)) {
			if (!isPlainObject(current)) return;
			const accepted = Object.keys(node.properties);
			const unknown = Object.keys(current).filter((key) => !accepted.includes(key));
			if (unknown.length > 0 && node.additionalProperties !== true && !isPlainObject(node.additionalProperties)) {
				out.push({ path, unknown, accepted });
			}
			for (const key of accepted) {
				if (key in current) walk(current[key], node.properties[key], [...path, key]);
			}
			if (isPlainObject(node.additionalProperties)) {
				for (const key of unknown) walk(current[key], node.additionalProperties, [...path, key]);
			}
			return;
		}

		const members = node.oneOf ?? node.anyOf;
		if (Array.isArray(members)) {
			if (!isPlainObject(current)) return;
			const member = selectMember(members, current, schema);
			if (member !== undefined) walk(current, member, path);
			return;
		}

		if (Array.isArray(current)) {
			if (Array.isArray(node.prefixItems)) {
				for (const [index, item] of node.prefixItems.entries()) walk(current[index], item, [...path, String(index)]);
			}
			if (isPlainObject(node.items)) {
				for (const [index, item] of current.entries()) walk(item, node.items, [...path, String(index)]);
			}
			return;
		}

		if (isPlainObject(current) && node.type === "object" && node.additionalProperties === false) {
			const unknown = Object.keys(current);
			if (unknown.length > 0) out.push({ path, unknown, accepted: [] });
		}
	};
	walk(value, schema, []);
	return out;
};

/**
 * The exact wording the pre-Effect `strict()` helper produced, so agents
 * that learned to self-correct on it keep working.
 */
const formatUnknownKeys = (levels: ReadonlyArray<UnknownKeysAtLevel>): string =>
	levels
		.map((level) => {
			const qualify = (key: string) => truncate([...level.path, key].join("."));
			const accepted = level.accepted.length === 0 ? "(none)" : level.accepted.join(", ");
			return `Unrecognized parameter(s): ${level.unknown.map(qualify).join(", ")}. Accepted params: ${accepted}`;
		})
		.join(" ");

/**
 * MCP models `structuredContent` as a JSON object, so a `null`, array or
 * primitive encoded result is omitted rather than sent through as-is.
 */
const toStructuredContent = (value: unknown): Schema.JsonObject | undefined =>
	isPlainObject(value) ? (value as Schema.JsonObject) : undefined;

const declaredFailureResult = (message: string): McpSchema.CallToolResult =>
	new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: message }] });

const envelopeResult = (toolName: string, err: unknown): McpSchema.CallToolResult => {
	const envelope = buildUnexpectedToolErrorEnvelope(toolName, err);
	return new McpSchema.CallToolResult({
		isError: true,
		structuredContent: envelope as unknown as Schema.JsonObject,
		content: [{ type: "text", text: JSON.stringify(envelope) }],
	});
};

/**
 * Register every tool of `toolkit` with the ambient `McpServer` under the
 * strict contract described in the module docs.
 *
 * @internal
 */
export const registerStrictToolkitEffect: <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
) => Effect.Effect<
	void,
	never,
	McpServer.McpServer | Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpSchema.McpServerClient>
> = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) {
	const registry = yield* McpServer.McpServer;
	const built = yield* toolkit as unknown as Effect.Effect<
		Toolkit.WithHandler<Tools>,
		never,
		Exclude<Tool.HandlersFor<Tools>, McpSchema.McpServerClient>
	>;
	const services = yield* Effect.context<never>();
	for (const tool of Object.values(built.tools)) {
		const annotations = tool.annotations;
		const render = Context.get(annotations, RenderText);
		const isDeclaredFailure = Schema.is(tool.failureSchema);
		const toolMeta = Context.getOrUndefined(annotations, Tool.Meta);
		const outputJsonSchema = inlineRootRefs(Tool.getJsonSchemaFromSchema(tool.successSchema) as JsonObject);
		const outputSchema =
			outputJsonSchema.type === "object"
				? yield* Schema.decodeUnknownEffect(McpSchema.ToolJsonSchema)(outputJsonSchema).pipe(Effect.orDie)
				: undefined;
		const servedInput = strictifyJsonSchema(Tool.getJsonSchema(tool) as JsonObject);
		const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJsonSchema)(servedInput).pipe(Effect.orDie);
		const mcpTool = new McpSchema.Tool({
			name: tool.name,
			description: Tool.getDescription(tool),
			inputSchema,
			...(outputSchema === undefined ? {} : { outputSchema }),
			annotations: {
				...Context.getOption(annotations, Tool.Title).pipe(
					Option.map((title) => ({ title })),
					Option.getOrUndefined,
				),
				readOnlyHint: Context.get(annotations, Tool.Readonly),
				destructiveHint: Context.get(annotations, Tool.Destructive),
				idempotentHint: Context.get(annotations, Tool.Idempotent),
				openWorldHint: Context.get(annotations, Tool.OpenWorld),
			},
			_meta: toolMeta,
		});
		yield* registry.addTool({
			tool: mcpTool,
			annotations,
			handle(payload: unknown) {
				const raw = payload ?? {};
				const unknownKeys = collectUnknownKeys(raw, servedInput);
				if (unknownKeys.length > 0) {
					return Effect.fail(new McpSchema.InvalidParams({ message: formatUnknownKeys(unknownKeys) }));
				}
				return built.handle(tool.name as keyof Tools, raw as never).pipe(
					Stream.unwrap,
					Stream.run(Sink.last()),
					Effect.flatMap(Effect.fromOption),
					Effect.map((result) => {
						const encoded: unknown = result.encodedResult;
						const text = render?.(encoded) ?? JSON.stringify(encoded);
						return new McpSchema.CallToolResult({
							isError: false,
							structuredContent: toStructuredContent(encoded),
							content: encoded === undefined ? [] : [{ type: "text", text }],
						});
					}),
					Effect.provideContext(services as Context.Context<Tool.HandlerServices<Tools[keyof Tools]>>),
					Effect.catchCause((cause) => {
						const failure = Cause.findError(cause);
						if (Result.isFailure(failure) && !Cause.hasDies(cause)) {
							// Interruption only: let it propagate untouched.
							return Effect.failCause(failure.failure);
						}
						const err: unknown = Result.isSuccess(failure) ? failure.success : Cause.squash(cause);
						if (AiError.isAiError(err) && err.reason._tag === "ToolParameterValidationError") {
							return Effect.fail(new McpSchema.InvalidParams({ message: err.reason.message }));
						}
						const logged = Effect.logError(`tool ${tool.name} failed`, cause);
						if (isDeclaredFailure(err) && err instanceof Error) {
							// Upstream parity: a declared, Error-shaped failure ships its
							// message as text with no structuredContent.
							return Effect.as(logged, declaredFailureResult(err.message));
						}
						return Effect.as(logged, envelopeResult(tool.name, err));
					}),
				);
			},
		});
	}
});

/**
 * A layer that registers `toolkit` with the strict contract. Same shape
 * as `McpServer.toolkit`: it requires the toolkit's handlers (from
 * `kit.toLayer(handlers)`) and every service the tools declare in
 * `dependencies`, and shares the memoized `McpServer` with the transport
 * layer it is provided into.
 *
 * @public
 */
export const registerStrictToolkit = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
): Layer.Layer<
	never,
	never,
	Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpSchema.McpServerClient>
> => Layer.effectDiscard(registerStrictToolkitEffect(toolkit)).pipe(Layer.provide(McpServer.McpServer.layer));
