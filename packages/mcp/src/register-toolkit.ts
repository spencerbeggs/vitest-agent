// Strict toolkit registration for the Effect-native MCP server.
//
// `McpServer.toolkit` decodes tool arguments with Effect's default
// `onExcessProperty: "ignore"` unless a tool is annotated `Tool.Strict`, so
// an unknown key on a lenient tool is silently stripped — a misspelled
// filter runs a *wider* query while reporting success (issues #200 / #243).
// Since rc.116 (Effect-TS/effect#8218) a `Tool.Strict` tool is decoded with
// `onExcessProperty: "error"` and served with `additionalProperties: false`
// on every object node, but the rejection reads `Expected no excess
// property at ["key"]`: first key only, and no list of what IS accepted.
// This module registers each tool over the public
// `McpServer.McpServer.addTool` instead and:
//
// 1. treats every tool as strict, whatever its `Tool.Strict` annotation
//    says: strict decode options, and the input document Effect builds with
//    `onExcessProperty: "error"`;
// 2. walks the raw payload against that served schema before decoding and
//    fails with `InvalidParams` naming every unknown key and the accepted
//    params, at every object level (the native strict decode stays behind
//    it as a backstop);
// 3. rewrites a top-level `action` / `kind` union to an object root with
//    `oneOf` + `x-discriminator`, and inlines a `$ref` root (what an
//    `identifier` annotation produces), so the served schema meets MCP's
//    object-root requirement;
// 4. maps a declared failure exactly as Effect's own `registerToolkit`
//    does (an `Error`-shaped one to `{ isError: true, content: [{ text:
//    error.message }] }`, any other to its encoded JSON as text), and every
//    OTHER failure or defect to the `UnexpectedToolError` envelope as
//    `structuredContent` with `isError: true`, so an in-boundary crash
//    comes back in the same structured shape as every other tool error.
//
// `registerStrictToolkitEffect` is a line-for-line port of Effect's
// `registerToolkit` (`effect/unstable/ai/McpServer.ts`, rc.116). Baseline
// for the next rc bump — the places it knowingly deviates, to re-check
// against the new source:
//
//  (i)   every tool is strict, and the raw payload is walked against the
//        served schema BEFORE `built.handle` (`collectUnknownKeys` →
//        `InvalidParams`) so the message names every unknown key and the
//        accepted params. A strict dynamic tool still dies at registration,
//        as upstream does; this repo ships none.
//  (ii)  the served input schema is rc.116's `toolInputJsonSchema` output
//        passed through `objectRootedInputSchema` (the `$ref` hoist that
//        rc.116 does through the internal `resolveTopLevelReference`, plus
//        the discriminated-union rewrite).
//  (iii) retired (#487): the success branch sends `JSON.stringify(encoded)`
//        as `content[0].text`, as upstream does. Claude Code forwards only
//        `structuredContent` to the model, so a markdown rendering there
//        was never read.
//  (iv)  an internal failure or defect renders the `UnexpectedToolError`
//        envelope (`structuredContent` + JSON text) instead of rc.116's
//        scrubbed "Tool execution failed due to an internal server error."
//        text; it is still logged at error level and reported through
//        `ErrorReporter` first, as upstream does.
//  (v)   `outputSchema` is served only when the success JSON Schema, after
//        `inlineRootRefs`, is object-rooted — rc.116 relaxed
//        `McpSchema.ToolOutputJson` to any JSON object and serves every
//        document verbatim, but `@modelcontextprotocol/sdk`'s `ToolSchema`
//        still requires `outputSchema.type === "object"`, so an
//        `anyOf`-rooted document would break `tools/list` in strict
//        clients (upstream: Effect-TS/effect#8326, released in rc.117).
//  (vi)  `structuredContent` is omitted when the encoded result is not a
//        JSON object (MCP models it as an object); rc.116 passes the
//        encoded result through as-is.
//
// Not a deviation any more: rc.116 stopped logging DECLARED failures (only
// the internal branch goes through `Effect.logError` + `ErrorReporter`),
// and this port follows it — no shipped tool declares a `failure` schema.

import type { SchemaAST } from "effect";
import { Cause, Context, Effect, ErrorReporter, Layer, Option, References, Result, Schema, Stream } from "effect";
import { AiError, McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpServerRequest } from "effect/unstable/http";
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
 * Make an input JSON Schema servable as an MCP tool input: inline a `$ref`
 * root (and `$ref` members of a top-level union), and rewrite a top-level
 * union of discriminated object shapes to `{ type: "object", oneOf,
 * "x-discriminator" }` so it satisfies MCP's object-root requirement. The
 * object nodes themselves are left as Effect emitted them — closed, when the
 * document was built with `onExcessProperty: "error"`.
 *
 * @internal
 */
export const objectRootedInputSchema = (schema: JsonObject): JsonObject => {
	const root = inlineRootRefs(schema);
	const members = root.anyOf ?? root.oneOf;
	if (Array.isArray(members) && root.type === undefined) {
		const discriminant = findDiscriminant(members);
		if (discriminant !== undefined) {
			const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = root;
			return { type: "object", ...rest, oneOf: members, "x-discriminator": discriminant };
		}
	}
	return root;
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

const toolErrorResult = (message: string): McpSchema.CallToolResult =>
	new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: message }] });

const toolResultContent = (encoded: unknown): McpSchema.CallToolResult["content"] =>
	encoded === undefined ? [] : [{ type: "text", text: JSON.stringify(encoded) }];

// Request services must come from the invocation, including when a handler is registered during a request.
const omitRequestServices = Context.omit(
	McpSchema.McpRequestContext,
	McpSchema.McpServerClient,
	HttpServerRequest.HttpServerRequest,
	References.CurrentLogLevel,
);

const isParameterValidationError = (
	error: unknown,
): error is AiError.AiError & { readonly reason: AiError.ToolParameterValidationError } =>
	AiError.isAiError(error) && error.reason._tag === "ToolParameterValidationError";

/**
 * The input JSON Schema a tool is served with: the document rc.116's
 * `toolInputJsonSchema` builds for a strict tool (`Schema.toJsonSchemaDocument`
 * with `onExcessProperty: "error"`, so every object node carries
 * `additionalProperties: false`; definitions attached as `$defs`), made
 * object-rooted by {@link objectRootedInputSchema}.
 *
 * @internal
 */
export const servedInputJsonSchema = (schema: Schema.Constraint): JsonObject => {
	const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
	return objectRootedInputSchema(
		Object.keys(document.definitions).length === 0
			? (document.schema as JsonObject)
			: ({ ...document.schema, $defs: document.definitions } as JsonObject),
	);
};

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
 * strict contract described in the module docs. A port of rc.116's
 * `McpServer.registerToolkit`; the deviations are enumerated in the module
 * header.
 *
 * @internal
 */
export const registerStrictToolkitEffect: <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
) => Effect.Effect<
	void,
	never,
	McpServer.McpServer | Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpSchema.McpRequestContext>
> = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) {
	const registry = yield* McpServer.McpServer;
	const built = yield* (
		toolkit as unknown as Effect.Effect<
			Toolkit.WithHandler<Tools>,
			never,
			Exclude<Tool.HandlersFor<Tools>, McpSchema.McpRequestContext>
		>
	).pipe(
		Effect.updateContext((context: Context.Context<Exclude<Tool.HandlersFor<Tools>, McpSchema.McpRequestContext>>) => {
			// Toolkit handlers also retain the context in which their layer was built.
			const services = new Map(context.mapUnsafe);
			for (const tool of Object.values(toolkit.tools)) {
				const handler = services.get(tool.id) as Tool.Handler<string> | undefined;
				if (handler !== undefined) {
					services.set(tool.id, { ...handler, context: omitRequestServices(handler.context) });
				}
			}
			return Context.makeUnsafe(services);
		}),
	);
	const services = omitRequestServices(yield* Effect.context<never>());
	const reportCause = (cause: Cause.Cause<unknown>) => Effect.provideContext(ErrorReporter.report(cause), services);
	const registrations: Array<Parameters<typeof registry.addTool>[0]> = [];
	for (const tool of Object.values(built.tools) as ReadonlyArray<Tool.Any>) {
		// Interruption propagates; anything else is logged, reported and — deviation
		// (iv) — rendered as the `UnexpectedToolError` envelope rather than scrubbed.
		const internalToolError = (cause: Cause.Cause<unknown>) => {
			const failure = Cause.findFail(cause);
			return Result.isFailure(failure) && !Cause.hasDies(cause)
				? Effect.failCause(failure.failure)
				: Effect.logError(`tool ${tool.name} failed`, cause).pipe(
						Effect.andThen(reportCause(cause)),
						Effect.as(
							envelopeResult(tool.name, Result.isSuccess(failure) ? failure.success.error : Cause.squash(cause)),
						),
					);
		};
		// Deviation (i): every tool is strict, so a dynamic tool's raw JSON Schema cannot be served.
		if (Tool.isDynamic(tool)) {
			return yield* Effect.die(
				`McpServer cannot strictly validate the raw JSON Schema for tool '${tool.name}'; use an Effect Schema instead`,
			);
		}
		const decodeOptions: SchemaAST.ParseOptions = { onExcessProperty: "error" };
		const annotations = tool.annotations;
		const toolMeta = Context.getOrUndefined(annotations, Tool.Meta);
		const isDeclaredFailure = Schema.is(tool.failureSchema);
		const encodeFailure = Schema.encodeUnknownEffect(tool.failureSchema) as (
			error: unknown,
		) => Effect.Effect<unknown, Schema.SchemaError, Tool.HandlerServices<Tools[keyof Tools]>>;
		const declaredFailureResult = (error: unknown) =>
			error instanceof Error
				? Effect.succeed(toolErrorResult(error.message))
				: Effect.map(
						encodeFailure(error),
						(encoded) => new McpSchema.CallToolResult({ isError: true, content: toolResultContent(encoded) }),
					);
		const handleCause = (cause: Cause.Cause<unknown>) => {
			const failure = Cause.findFail(cause);
			if (Result.isSuccess(failure)) {
				const error = failure.success.error;
				const origin = Context.get(Cause.reasonAnnotations(failure.success), Toolkit.FailureOrigin);
				if (origin === "parameters" && isParameterValidationError(error)) {
					return Effect.fail(new McpSchema.InvalidParams({ message: error.reason.message }));
				}
				if (origin === "handler" && isDeclaredFailure(error)) {
					return Effect.catchCause(declaredFailureResult(error), internalToolError);
				}
			}
			return internalToolError(cause);
		};
		// Deviation (v): the output document is served only when object-rooted.
		const outputJsonSchema = inlineRootRefs(Tool.getJsonSchemaFromSchema(tool.successSchema) as JsonObject);
		const outputSchema =
			outputJsonSchema.type === "object"
				? yield* Schema.decodeUnknownEffect(McpSchema.ToolOutputJson)(outputJsonSchema).pipe(Effect.orDie)
				: undefined;
		// Deviation (ii): the served input schema is closed at every level and object-rooted.
		const servedInput = servedInputJsonSchema(tool.parametersSchema);
		const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJson)(servedInput).pipe(Effect.orDie);
		const description = Tool.getDescription(tool);
		const mcpTool = new McpSchema.Tool({
			name: tool.name,
			...(description === undefined ? {} : { description }),
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
			...(toolMeta === undefined ? {} : { _meta: toolMeta as Schema.JsonObject }),
		});
		registrations.push({
			tool: mcpTool,
			annotations,
			handle(payload: unknown) {
				const raw = payload ?? {};
				// Deviation (i): the every-level unknown-key walk, before decoding.
				const unknownKeys = collectUnknownKeys(raw, servedInput);
				if (unknownKeys.length > 0) {
					return Effect.fail(new McpSchema.InvalidParams({ message: formatUnknownKeys(unknownKeys) }));
				}
				return built.handle(tool.name as keyof Tools, raw as never, undefined, decodeOptions).pipe(
					Stream.unwrap,
					Stream.runLast,
					Effect.flatMap(Effect.fromOption),
					Effect.flatMap((result) =>
						// Declared failures return their encoded payload; anything else is classified by origin.
						result.isFailure && result.failureOrigin !== "handler"
							? Effect.failCause(
									Cause.annotate(
										Cause.fail(result.result),
										Context.make(Toolkit.FailureOrigin, result.failureOrigin ?? "result"),
									),
								)
							: Effect.succeed(
									new McpSchema.CallToolResult({
										isError: result.isFailure,
										// Deviation (vi): a non-object encoded result carries no structuredContent.
										structuredContent: result.isFailure ? undefined : toStructuredContent(result.encodedResult),
										content: toolResultContent(result.encodedResult),
									}),
								),
					),
					Effect.catchCause(handleCause),
					Effect.provideContext(services as Context.Context<Tool.HandlerServices<Tools[keyof Tools]>>),
				);
			},
		});
	}
	for (const registration of registrations) {
		yield* registry.addTool(registration);
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
	Tool.HandlersFor<Tools> | Exclude<Tool.HandlerServices<Tools>, McpSchema.McpRequestContext>
> => Layer.effectDiscard(registerStrictToolkitEffect(toolkit)).pipe(Layer.provide(McpServer.McpServer.layer));
