/**
 * Enum-drift guard for the discriminated tools on the Effect-native
 * server: the set of `action` / `kind` literals across the served `oneOf`
 * members must equal the exported tuple (`TEST_ACTIONS`,
 * `INVENTORY_KINDS`). The tuples carry a compile-time two-way assertion
 * against the input union; this pins the WIRE side the same way (issue
 * #335).
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { INVENTORY_KINDS } from "../src/tools/inventory.js";
import { TEST_ACTIONS } from "../src/tools/test.js";
import type { McpToolDescriptor } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

type JsonObject = Record<string, unknown>;

const listAllTools = (): Promise<ReadonlyArray<McpToolDescriptor>> =>
	Effect.runPromise(
		Effect.scoped(Effect.flatMap(makeHarness(), (h) => h.initialize().pipe(Effect.andThen(h.listTools)))),
	);

/** The discriminant literals of every `oneOf` member, read from `const` or a one-element `enum`. */
const servedDiscriminants = (tool: McpToolDescriptor, key: string): ReadonlyArray<string> => {
	const members = tool.inputSchema.oneOf as ReadonlyArray<JsonObject>;
	return members.map((member, index) => {
		const property = (member.properties as Record<string, JsonObject>)[key];
		expect(property, `${tool.name} oneOf[${index}] has a ${key} property`).toBeDefined();
		const literal = property?.const ?? (Array.isArray(property?.enum) ? property.enum[0] : undefined);
		expect(typeof literal, `${tool.name} oneOf[${index}].${key} literal`).toBe("string");
		if (Array.isArray(property?.enum))
			expect(property.enum, `${tool.name} oneOf[${index}].${key} single`).toHaveLength(1);
		expect((member.required as ReadonlyArray<string>) ?? [], `${tool.name} oneOf[${index}] requires ${key}`).toContain(
			key,
		);
		return literal as string;
	});
};

describe("served discriminant enums match the exported tuples", () => {
	it("test: every oneOf member's action equals one TEST_ACTIONS entry, and vice versa", async () => {
		const tool = (await listAllTools()).find((t) => t.name === "test") as McpToolDescriptor;
		expect(tool.inputSchema["x-discriminator"]).toBe("action");
		const served = servedDiscriminants(tool, "action");
		expect(new Set(served).size, "no duplicate action literal").toBe(served.length);
		expect([...served].sort()).toEqual([...TEST_ACTIONS].sort());
	});

	it("inventory: every oneOf member's kind equals one INVENTORY_KINDS entry, and vice versa", async () => {
		const tool = (await listAllTools()).find((t) => t.name === "inventory") as McpToolDescriptor;
		expect(tool.inputSchema["x-discriminator"]).toBe("kind");
		const served = servedDiscriminants(tool, "kind");
		expect(new Set(served).size, "no duplicate kind literal").toBe(served.length);
		expect([...served].sort()).toEqual([...INVENTORY_KINDS].sort());
	});
});
