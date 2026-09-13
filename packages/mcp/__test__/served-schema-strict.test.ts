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
	it("lists exactly the 30 served tools", async () => {
		const names = (await listAllTools()).map((t) => t.name);
		expect([...names].sort()).toEqual(
			[
				"ping",
				"help",
				"test_status",
				"test_overview",
				"test_coverage",
				"test_history",
				"test_trends",
				"test_errors",
				"file_coverage",
				"settings_list",
				"cache_health",
				"configure",
				"commit_changes",
				"turn_search",
				"failure_signature_get",
				"acceptance_metrics",
				"triage_brief",
				"wrapup_prompt",
				"inventory",
				"test",
				"register_agent",
				"note",
				"hypothesis",
				"tdd_task",
				"tdd_phase_transition_request",
				"tdd_goal",
				"tdd_behavior",
				"tdd_artifact_list",
				"tdd_progress_push",
				"run_tests",
			].sort(),
		);
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

interface CallToolResult {
	isError?: boolean;
	content: Array<{ type: string; text?: string }>;
}

const BOGUS_KEY = "__bogus_extra_key__";

/**
 * One minimal-but-schema-valid payload per served tool (ported from the
 * retired InMemoryTransport sweep). `run_tests` is excluded — it would
 * start Vitest — and is covered by `tools-write.test.ts`. `label`
 * disambiguates the multiple `test` cases so `it.each` titles stay unique.
 */
const cases: ReadonlyArray<[label: string, tool: string, validArgs: Record<string, unknown>]> = [
	["ping", "ping", {}],
	["help", "help", {}],
	["settings_list", "settings_list", {}],
	["cache_health", "cache_health", {}],
	["test_status", "test_status", {}],
	["test_overview", "test_overview", {}],
	["test_coverage", "test_coverage", {}],
	["test_history", "test_history", { project: "x" }],
	["test_trends", "test_trends", { project: "x" }],
	["test_errors", "test_errors", { project: "x" }],
	["test (list)", "test", { action: "list" }],
	["test (annotations)", "test", { action: "annotations", fullName: "x" }],
	["test (artifacts)", "test", { action: "artifacts", fullName: "x", maxBytes: 0 }],
	["file_coverage", "file_coverage", { filePath: "x" }],
	["configure", "configure", {}],
	["inventory", "inventory", { kind: "project" }],
	["register_agent", "register_agent", { chatId: "x", agentType: "claude-code-main-x" }],
	["note", "note", { action: "list" }],
	["turn_search", "turn_search", {}],
	["failure_signature_get", "failure_signature_get", { hash: "x" }],
	["tdd_task", "tdd_task", { action: "get", tddTaskId: 1 }],
	["tdd_phase_transition_request", "tdd_phase_transition_request", { tddTaskId: 1, goalId: 1, requestedPhase: "red" }],
	["tdd_goal", "tdd_goal", { action: "list", tddTaskId: 1 }],
	["tdd_behavior", "tdd_behavior", { action: "list_by_tdd_task", tddTaskId: 1 }],
	["tdd_artifact_list", "tdd_artifact_list", { tddTaskId: 1 }],
	["hypothesis", "hypothesis", { action: "list" }],
	["tdd_progress_push", "tdd_progress_push", { payload: "{}" }],
	["acceptance_metrics", "acceptance_metrics", {}],
	["triage_brief", "triage_brief", {}],
	["wrapup_prompt", "wrapup_prompt", {}],
	["commit_changes", "commit_changes", {}],
];

const callTool = (name: string, args: unknown): Promise<CallToolResult> =>
	Effect.runPromise(
		Effect.scoped(Effect.flatMap(makeHarness(), (h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))))),
	) as Promise<CallToolResult>;

const textOf = (result: CallToolResult): string => result.content.map((c) => c.text ?? "").join("\n");

describe("every served tool rejects unknown keys at call time", () => {
	it("covers every served tool except run_tests", async () => {
		const served = (await listAllTools()).map((t) => t.name).filter((n) => n !== "run_tests");
		expect([...new Set(cases.map(([, tool]) => tool))].sort()).toEqual(served.sort());
	});

	it.each(cases)("%s rejects an unknown parameter instead of silently stripping it", async (label, tool, validArgs) => {
		const result = await callTool(tool, { ...validArgs, [BOGUS_KEY]: true });
		expect(result.isError, `${label} should reject an unknown key`).toBe(true);
		expect(textOf(result), `${label}'s error should name the offending key`).toContain(BOGUS_KEY);
	});

	it.each(cases)("%s still accepts its own documented params with no unknown keys", async (label, tool, validArgs) => {
		const result = await callTool(tool, validArgs);
		// The strictness pass must not become over-strict: a call carrying
		// only documented params must never fail at the parameter boundary
		// (isError may still be true for domain reasons, e.g. register_agent's
		// SESSION_NOT_FOUND, but never for schema shape).
		const text = textOf(result);
		expect(text, `${label} rejected its own valid params`).not.toContain("Unrecognized parameter(s)");
		expect(text, `${label} failed schema decoding`).not.toMatch(/Expected .* actual|is missing|Missing key/);
	});
});
