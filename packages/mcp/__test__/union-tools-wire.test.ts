/**
 * The seven union-parameter tools (`McpToolkit.unionTool` +
 * `McpToolkit.unionHandler`) on the wire: the served input document is the
 * pre-kit pipeline's (Effect's strict document for the union, object-rooted
 * by `ToolInputSchema.objectRooted`), and a bad call is answered on each
 * revision's invalid-params surface — a JSON-RPC `-32602` error on
 * `2025-06-18`, an `isError` result on `2025-11-25` — exactly like a
 * `Tool.make` decode failure. Pinned through the real `test` tool.
 */

import { ToolInputSchema } from "@effected/mcp";
import type { JsonSchema } from "effect";
import { Effect, Schema } from "effect";
import { McpProtocol, Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";
import { Kit } from "../src/toolkit.js";
import type { JsonRpcMessage, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

const withHarness = <A>(
	f: (harness: McpHarness) => Effect.Effect<A>,
	options?: Parameters<typeof makeHarness>[0],
): Promise<A> => Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

/** The pre-kit `_union-schema.ts` pipeline, kept verbatim as the byte-identity reference. */
const preKitInputJsonSchema = (parameters: Schema.Top): JsonSchema.JsonSchema => {
	const document = Schema.toJsonSchemaDocument(parameters, { onExcessProperty: "error" });
	return ToolInputSchema.objectRooted(
		Object.keys(document.definitions).length === 0
			? document.schema
			: { ...document.schema, $defs: document.definitions },
	);
};

const UNION_TOOLS = ["hypothesis", "inventory", "note", "tdd_behavior", "tdd_goal", "tdd_task", "test"];

const unionTools = Object.values(Kit.tools).flatMap((tool) =>
	"unionParameters" in tool ? [tool as typeof tool & { readonly unionParameters: Schema.Top }] : [],
);

interface CallToolResult {
	isError?: boolean;
	structuredContent?: unknown;
	content: Array<{ type: string; text?: string }>;
}

/** `tools/call` on `2025-06-18`, returning the whole JSON-RPC response. */
const callOn0618 = (args: unknown): Promise<JsonRpcMessage> =>
	withHarness(
		(h) => h.initialize().pipe(Effect.andThen(h.sendRequest("tools/call", { name: "test", arguments: args }))),
		{
			protocol: McpProtocol.v2025_06_18,
		},
	);

const jsonError = (message: JsonRpcMessage): { code: number; message: string } => {
	expect(message.result).toBeUndefined();
	return message.error as { code: number; message: string };
};

describe("union-parameter tools", () => {
	it("are exactly the seven action-keyed tools, each a Tool.dynamic carrying its union", () => {
		expect(unionTools.map((tool) => tool.name).sort()).toEqual(UNION_TOOLS);
		for (const tool of unionTools) expect(Tool.isDynamic(tool), tool.name).toBe(true);
	});

	it("serve the pre-kit input document byte for byte", async () => {
		const served = await withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));
		for (const tool of unionTools) {
			const expected = preKitInputJsonSchema(tool.unionParameters);
			expect(JSON.stringify(Tool.getJsonSchema(tool)), tool.name).toBe(JSON.stringify(expected));
			const listed = served.find((entry) => entry.name === tool.name);
			expect(JSON.stringify(listed?.inputSchema), tool.name).toBe(JSON.stringify(expected));
		}
	});

	describe("on 2025-06-18 a bad call is a JSON-RPC -32602 error", () => {
		it("naming an unknown top-level key", async () => {
			const error = jsonError(await callOn0618({ action: "list", bogus: 1 }));
			expect(error.code).toBe(-32602);
			expect(error.message).toContain("Unrecognized parameter(s): bogus.");
		});

		it("naming a key that belongs to a sibling branch", async () => {
			const error = jsonError(await callOn0618({ action: "list", fullName: "x" }));
			expect(error.code).toBe(-32602);
			expect(error.message).toContain("Unrecognized parameter(s): fullName.");
		});

		it("naming the tool for an unknown discriminant or a wrong value type", async () => {
			for (const args of [{ action: "nope" }, { action: "list", limit: "ten" }]) {
				const error = jsonError(await callOn0618(args));
				expect(error.code, JSON.stringify(args)).toBe(-32602);
				expect(error.message, JSON.stringify(args)).toContain("Invalid parameters for tool 'test':");
			}
		});
	});

	it("on 2025-11-25 the same rejection is an isError result with the message", async () => {
		const result = (await withHarness((h) =>
			h.initialize().pipe(Effect.andThen(h.callTool("test", { action: "list", bogus: 1 }))),
		)) as CallToolResult;
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
		expect(result.content[0]?.text).toContain("Unrecognized parameter(s): bogus.");
	});
});
