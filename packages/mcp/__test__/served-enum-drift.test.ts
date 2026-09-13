/**
 * Enum-drift guard for the discriminated tools on the Effect-native
 * server: the set of `action` / `kind` literals across the served `oneOf`
 * members must equal the exported tuple (`TEST_ACTIONS`,
 * `INVENTORY_KINDS`, `NOTE_ACTIONS`, `HYPOTHESIS_ACTIONS`,
 * `TDD_TASK_ACTIONS`, `TDD_GOAL_ACTIONS`, `TDD_BEHAVIOR_ACTIONS`). The tuples carry a compile-time two-way assertion
 * against the input union; this pins the WIRE side the same way (issue
 * #335).
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HYPOTHESIS_ACTIONS } from "../src/tools/hypothesis.js";
import { INVENTORY_KINDS } from "../src/tools/inventory.js";
import { NOTE_ACTIONS } from "../src/tools/note.js";
import { TDD_BEHAVIOR_ACTIONS } from "../src/tools/tdd-behavior.js";
import { TDD_GOAL_ACTIONS } from "../src/tools/tdd-goal.js";
import { TDD_TASK_ACTIONS } from "../src/tools/tdd-task.js";
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

/** Field descriptions the served oneOf members must carry (the pre-port zod `.describe()` text). */
const EXPECTED_DESCRIPTIONS: Record<string, Record<string, Record<string, string>>> = {
	test: {
		list: {
			state: "list: filter by state",
			module: "list: filter by module path",
			limit: "list: max rows to return",
		},
		get: { fullName: "get / annotations / artifacts: full test name" },
		for_file: { filePath: "for_file: source file path" },
		for_tag: { tag: "for_tag: tag name" },
		annotations: { fullName: "get / annotations / artifacts: full test name" },
		artifacts: { fullName: "get / annotations / artifacts: full test name" },
	},
	inventory: {
		suite: { module: "suite: filter by module path" },
		session: {
			id: "session: single-row lookup by id",
			agentKind: "session: filter by agent kind",
			limit: "session: max rows",
		},
	},
	note: {
		create: { action: "CRUD discriminator", scope: "create: required scope; list: optional filter" },
		list: { scope: "create: required scope; list: optional filter" },
		get: { id: "get/update/delete: note id" },
		update: { id: "get/update/delete: note id" },
		delete: { id: "get/update/delete: note id" },
		search: { query: "search: FTS5 query" },
	},
	hypothesis: {
		record: {
			tddTaskId:
				"record: tdd task id returned by tdd_task action='start' — binds the hypothesis to that task's session deterministically",
			content: "Hypothesis content (action=record)",
		},
		validate: { id: "Hypothesis id (action=validate)", validatedAt: "ISO 8601 timestamp (action=validate)" },
		list: {
			sessionId:
				"list: filter by session id. record: dev/test fallback only — ignored when host context is recovered; never pass a tddTaskId value here",
		},
	},
	tdd_task: {
		start: {
			action: "Lifecycle discriminator",
			goal: "start: goal text",
			sessionId: "start: sessions.id (alternative to chatId)",
			chatId: "start: host chat UUID",
			parentTddTaskId: "start: parent task id when decomposing",
		},
		end: { tddTaskId: "end/get/resume: tdd task id", outcome: "end: final outcome" },
		get: { tddTaskId: "end/get/resume: tdd task id" },
		resume: { tddTaskId: "end/get/resume: tdd task id" },
	},
	tdd_goal: {
		create: { tddTaskId: "create/list: tdd task id" },
		update: { id: "update/delete/get: goal id" },
		delete: { id: "update/delete/get: goal id" },
		get: { id: "update/delete/get: goal id" },
		list: { tddTaskId: "create/list: tdd task id" },
	},
	tdd_behavior: {
		create: { action: "CRUD discriminator" },
	},
};

/** Every action-discriminated tool paired with its exported tuple. */
const ACTION_TUPLES: Record<string, ReadonlyArray<string>> = {
	test: TEST_ACTIONS,
	note: NOTE_ACTIONS,
	hypothesis: HYPOTHESIS_ACTIONS,
	tdd_task: TDD_TASK_ACTIONS,
	tdd_goal: TDD_GOAL_ACTIONS,
	tdd_behavior: TDD_BEHAVIOR_ACTIONS,
};

const memberByDiscriminant = (tool: McpToolDescriptor, key: string, literal: string): JsonObject => {
	const members = tool.inputSchema.oneOf as ReadonlyArray<JsonObject>;
	const member = members.find((m) => {
		const property = (m.properties as Record<string, JsonObject>)[key];
		return property?.const === literal || (Array.isArray(property?.enum) && property.enum[0] === literal);
	});
	expect(member, `${tool.name} oneOf member for ${key}=${literal}`).toBeDefined();
	return member as JsonObject;
};

describe("served oneOf member fields keep their descriptions", () => {
	for (const [toolName, variants] of Object.entries(EXPECTED_DESCRIPTIONS)) {
		const key = toolName === "inventory" ? "kind" : "action";
		it(`${toolName}: every expected field description is served on its oneOf member`, async () => {
			const tool = (await listAllTools()).find((t) => t.name === toolName) as McpToolDescriptor;
			for (const [literal, fields] of Object.entries(variants)) {
				const member = memberByDiscriminant(tool, key, literal);
				const properties = member.properties as Record<string, JsonObject>;
				for (const [field, description] of Object.entries(fields)) {
					expect(properties[field]?.description, `${toolName}.${literal}.${field}`).toBe(description);
				}
			}
		});
	}
});

describe("served discriminant enums match the exported tuples", () => {
	for (const [toolName, tuple] of Object.entries(ACTION_TUPLES)) {
		it(`${toolName}: every oneOf member's action equals one tuple entry, and vice versa`, async () => {
			const tool = (await listAllTools()).find((t) => t.name === toolName) as McpToolDescriptor;
			expect(tool, toolName).toBeDefined();
			expect(tool.inputSchema["x-discriminator"]).toBe("action");
			const served = servedDiscriminants(tool, "action");
			expect(new Set(served).size, "no duplicate action literal").toBe(served.length);
			expect([...served].sort()).toEqual([...tuple].sort());
		});
	}

	it("inventory: every oneOf member's kind equals one INVENTORY_KINDS entry, and vice versa", async () => {
		const tool = (await listAllTools()).find((t) => t.name === "inventory") as McpToolDescriptor;
		expect(tool.inputSchema["x-discriminator"]).toBe("kind");
		const served = servedDiscriminants(tool, "kind");
		expect(new Set(served).size, "no duplicate kind literal").toBe(served.length);
		expect([...served].sort()).toEqual([...INVENTORY_KINDS].sort());
	});
});
