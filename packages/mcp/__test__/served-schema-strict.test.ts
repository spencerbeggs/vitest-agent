/**
 * The served-schema strictness sweep over the Effect-native server: every
 * object node in every tool's `inputSchema` carries
 * `additionalProperties: false`, so an unknown key at ANY depth is
 * rejected rather than silently stripped (issues #200 / #243). A
 * discriminated-union root is served as `oneOf` + `x-discriminator` and
 * has no `additionalProperties` by design; each of its members is an
 * object and must be strict.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { McpToolDescriptor } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null;

/** Collect every `{ type: "object" }` node reachable from `node`, with its JSON path. */
const collectObjectNodes = (node: unknown, path: string, out: Array<{ path: string; node: JsonObject }>): void => {
	if (Array.isArray(node)) {
		for (const [index, item] of node.entries()) collectObjectNodes(item, `${path}[${index}]`, out);
		return;
	}
	if (!isObject(node)) return;
	// A node with `properties` but no `type` is still an object shape — do not let it slip past.
	if (node.type === "object" || isObject(node.properties)) out.push({ path, node });
	for (const [key, value] of Object.entries(node)) {
		if (key === "properties" && isObject(value)) {
			for (const [propertyName, propertySchema] of Object.entries(value)) {
				collectObjectNodes(propertySchema, `${path}.properties.${propertyName}`, out);
			}
		} else if (key !== "enum" && key !== "const" && key !== "required" && key !== "examples") {
			collectObjectNodes(value, `${path}.${key}`, out);
		}
	}
};

const listAllTools = (): Promise<ReadonlyArray<McpToolDescriptor>> =>
	Effect.runPromise(
		Effect.scoped(Effect.flatMap(makeHarness(), (h) => h.initialize().pipe(Effect.andThen(h.listTools)))),
	);

describe("served input schemas are strict at every object level", () => {
	it("lists at least the two already-ported tools plus the read-only set", async () => {
		const names = (await listAllTools()).map((t) => t.name);
		expect(names).toEqual(expect.arrayContaining(["ping", "help", "test_status", "test_errors"]));
	});

	it("every object node carries additionalProperties: false; a oneOf root is exempt but each member is strict", async () => {
		const tools = await listAllTools();
		expect(tools.length).toBeGreaterThan(0);
		for (const tool of tools) {
			const root = tool.inputSchema;
			// MCP's ToolJsonSchema requires `type: "object"` at the root even for a `oneOf`.
			expect(root.type, `${tool.name} root type`).toBe("object");
			if (Array.isArray(root.oneOf)) {
				expect(root.properties, `${tool.name} oneOf root has no properties`).toBeUndefined();
				expect(root.additionalProperties, `${tool.name} oneOf root has no additionalProperties`).toBeUndefined();
				expect(typeof root["x-discriminator"], `${tool.name} x-discriminator`).toBe("string");
				expect(root.oneOf.length, `${tool.name} oneOf members`).toBeGreaterThan(0);
				for (const [index, member] of root.oneOf.entries()) {
					expect(isObject(member) && member.type, `${tool.name} oneOf[${index}] is an object schema`).toBe("object");
				}
			}
			const objects: Array<{ path: string; node: JsonObject }> = [];
			collectObjectNodes(root, `${tool.name}.inputSchema`, objects);
			const expectedMinimum = Array.isArray(root.oneOf) ? root.oneOf.length : 1;
			expect(objects.length, `${tool.name} object nodes`).toBeGreaterThanOrEqual(expectedMinimum);
			for (const { path, node } of objects) {
				// The exempt node: a oneOf root is a dispatcher, not a shape.
				if (node === root && Array.isArray(root.oneOf)) continue;
				expect(node.additionalProperties, `${path} additionalProperties`).toBe(false);
			}
		}
	});
});
