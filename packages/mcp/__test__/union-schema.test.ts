/**
 * `_union-schema.ts`: the served input document of a union-parameter tool,
 * the strict decode its handler runs, and the object-rooted success union.
 * The wire side (every served tool rejecting a bogus key, the served `oneOf`
 * enums) is pinned by `served-schema-strict.test.ts` and
 * `served-enum-drift.test.ts`.
 */

import { Effect, Exit, Schema } from "effect";
import { McpSchema, Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";
import {
	decodeStrictUnion,
	objectRootedUnion,
	strictUnionTool,
	unionInputJsonSchema,
} from "../src/tools/_union-schema.js";

const Params = Schema.Union([
	Schema.Struct({ action: Schema.Literal("list"), project: Schema.optionalKey(Schema.String) }),
	Schema.Struct({
		action: Schema.Literal("get"),
		id: Schema.Finite,
		tags: Schema.optionalKey(Schema.Struct({ all: Schema.Array(Schema.String) })),
	}),
]);

const fixtureTool = strictUnionTool("fixture", {
	description: "Throwaway union-parameter tool.",
	parameters: Params,
	success: Schema.Struct({ ok: Schema.Boolean }),
});

const handle = decodeStrictUnion(fixtureTool, Params, (params) => Effect.succeed(params));

const failureMessage = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) throw new Error("expected a failure");
	const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
	expect(error).toBeInstanceOf(McpSchema.InvalidParams);
	return (error as McpSchema.InvalidParams).message;
};

describe("unionInputJsonSchema", () => {
	it("serves an object root with oneOf + x-discriminator and closes every member", () => {
		const served = unionInputJsonSchema(Params) as Record<string, unknown>;
		expect(served.type).toBe("object");
		expect(served["x-discriminator"]).toBe("action");
		expect(served.anyOf).toBeUndefined();
		const members = served.oneOf as ReadonlyArray<Record<string, unknown>>;
		expect(members).toHaveLength(2);
		for (const member of members) expect(member.additionalProperties).toBe(false);
	});

	it("is the raw schema the dynamic tool registers", () => {
		expect(Tool.isDynamic(fixtureTool)).toBe(true);
		expect(Tool.getJsonSchema(fixtureTool)).toEqual(unionInputJsonSchema(Params));
	});
});

describe("decodeStrictUnion", () => {
	it("decodes a valid payload and hands the typed params to the handler", async () => {
		expect(await Effect.runPromise(handle({ action: "get", id: 1, tags: { all: ["a"] } }))).toEqual({
			action: "get",
			id: 1,
			tags: { all: ["a"] },
		});
	});

	it("names every unknown key in the selected branch, nested ones included, before decoding", async () => {
		const exit = await Effect.runPromiseExit(handle({ action: "get", id: 1, bogus: 1, tags: { all: [], anyy: [] } }));
		expect(failureMessage(exit)).toBe(
			"Unrecognized parameter(s): bogus. Accepted params: action, id, tags. Unrecognized parameter(s): tags.anyy. Accepted params: all.",
		);
	});

	it("rejects a key that belongs to a sibling branch", async () => {
		const exit = await Effect.runPromiseExit(handle({ action: "list", id: 1 }));
		expect(failureMessage(exit)).toContain("Unrecognized parameter(s): id. Accepted params: action, project.");
	});

	it("fails an unknown discriminant or a wrong type as InvalidParams naming the tool", async () => {
		expect(failureMessage(await Effect.runPromiseExit(handle({ action: "nope" })))).toContain(
			"Invalid parameters for tool 'fixture':",
		);
		expect(failureMessage(await Effect.runPromiseExit(handle({ action: "get", id: "x" })))).toContain(
			"Invalid parameters for tool 'fixture':",
		);
	});

	it("treats an absent payload as {}", async () => {
		expect(failureMessage(await Effect.runPromiseExit(handle(undefined)))).toContain("Invalid parameters");
	});
});

describe("objectRootedUnion", () => {
	const Result = objectRootedUnion(
		Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), Schema.Struct({ ok: Schema.Literal(false) })]),
	).annotate({ identifier: "FixtureResult" });

	it("adds type: object beside the anyOf and keeps the identifier", () => {
		const document = Schema.toJsonSchemaDocument(Result);
		expect(document.schema).toEqual({ $ref: "#/$defs/FixtureResult" });
		const definition = document.definitions.FixtureResult as Record<string, unknown>;
		expect(definition.type).toBe("object");
		expect(definition.anyOf).toHaveLength(2);
	});

	it("leaves decoding unchanged", () => {
		expect(Schema.decodeUnknownSync(Result)({ ok: false })).toEqual({ ok: false });
		expect(() => Schema.decodeUnknownSync(Result)({ ok: "no" })).toThrow();
	});
});
