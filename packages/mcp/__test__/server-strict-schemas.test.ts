/**
 * Strictness-pass regression test (issue #200): every `registerTool`
 * input shape in `server.ts` that accepts parameters must reject an
 * unknown key, not silently strip it. Before this pass, only `run_tests`
 * rejected unknown keys (and even that started non-strict) — every other
 * tool's served schema would happily drop a mistyped/undeclared param.
 *
 * Each case supplies a minimal but schema-valid payload plus one bogus
 * extra key. Zod's strict-object validation runs as part of the MCP
 * SDK's `validateToolInput` step, which throws *before* the tool's
 * handler is ever invoked (see `executeToolHandler` in
 * `@modelcontextprotocol/sdk`) — so these calls never reach a real
 * DataStore/DataReader call despite using plausible-looking ids.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { buildMcpServer } from "../src/server.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

let client: Client;

beforeAll(async () => {
	const ctx: McpContext = {
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "server-strict-schemas-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

const BOGUS_KEY = "__bogus_extra_key__";

// One minimal-but-schema-valid payload per parameterized tool (excludes
// help/cache_health/settings_list/ping, which declare no inputSchema at
// all and so have nothing to strip).
const cases: ReadonlyArray<[tool: string, validArgs: Record<string, unknown>]> = [
	["test_status", {}],
	["test_overview", {}],
	["test_coverage", {}],
	["test_history", { project: "x" }],
	["test_trends", { project: "x" }],
	["test_errors", { project: "x" }],
	["test", { action: "list" }],
	["file_coverage", { filePath: "x" }],
	["configure", {}],
	["inventory", { kind: "project" }],
	["register_agent", { chatId: "x", agentType: "claude-code-main-x" }],
	["note", { action: "list" }],
	["turn_search", {}],
	["failure_signature_get", { hash: "x" }],
	["tdd_task", { action: "get" }],
	["tdd_phase_transition_request", { tddTaskId: 1, goalId: 1, requestedPhase: "red" }],
	["tdd_goal", { action: "list" }],
	["tdd_behavior", { action: "list_by_tdd_task" }],
	["tdd_artifact_list", { tddTaskId: 1 }],
	["hypothesis", { action: "list" }],
	["tdd_progress_push", { payload: "{}" }],
	["acceptance_metrics", {}],
	["triage_brief", {}],
	["wrapup_prompt", {}],
	["commit_changes", {}],
];

describe("every registerTool input shape rejects unknown keys", () => {
	it.each(cases)("%s rejects an unknown parameter instead of silently stripping it", async (tool, validArgs) => {
		const result = await client.callTool({
			name: tool,
			arguments: { ...validArgs, [BOGUS_KEY]: true },
		});
		expect(result.isError, `${tool} should reject an unknown key`).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text, `${tool}'s error should name the offending key`).toContain(BOGUS_KEY);
	});

	it.each(cases)("%s still accepts its own documented params with no unknown keys", async (tool, validArgs) => {
		const result = await client.callTool({ name: tool, arguments: validArgs });
		// The strictness pass must not become over-strict: a call carrying
		// only documented params must never fail with an MCP-level
		// InvalidParams error (isError may still be true for domain reasons,
		// e.g. register_agent's SESSION_NOT_FOUND, but never for schema shape).
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text, `${tool} rejected its own valid params`).not.toContain("Input validation error");
	});
});

/**
 * Issue #243: strictness has to hold at EVERY object level, not just the
 * top one. `run_tests` declared `tags` and `_sessionContext` as plain
 * `z.object`s nested inside a strict top level, so `{ tags: { anyy:
 * [...] } }` decoded to `{ tags: {} }` — the filter vanished and the run
 * went wide across the whole workspace with no error.
 *
 * This walks the *served* JSON Schema of every tool rather than calling
 * them, so it covers tools (like `run_tests`) that a rejection test
 * cannot safely exercise from a unit suite, and it keeps covering nested
 * shapes added later without anyone remembering to extend a case list.
 */
describe("served input schemas are strict at every nesting level", () => {
	const collectNonStrictObjectPaths = (node: unknown, path: string, out: string[]): void => {
		if (node === null || typeof node !== "object") return;
		const schema = node as Record<string, unknown>;

		if (schema.type === "object" && schema.additionalProperties !== false) {
			out.push(path);
		}

		const properties = schema.properties;
		if (properties !== null && typeof properties === "object") {
			for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
				collectNonStrictObjectPaths(value, `${path}.${key}`, out);
			}
		}
		// Optional/union/array wrappers: zod emits anyOf / items / $defs
		// around the object node rather than inlining it.
		for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
			const branch = schema[key];
			if (Array.isArray(branch)) {
				for (const [i, b] of branch.entries()) collectNonStrictObjectPaths(b, `${path}[${key}:${i}]`, out);
			}
		}
		if (schema.items !== undefined) collectNonStrictObjectPaths(schema.items, `${path}[]`, out);
		if (schema.$defs !== null && typeof schema.$defs === "object") {
			for (const [key, value] of Object.entries(schema.$defs as Record<string, unknown>)) {
				collectNonStrictObjectPaths(value, `${path}#${key}`, out);
			}
		}
	};

	// The four tools that declare no `inputSchema` at all (the documented
	// all-or-nothing carve-out from issue #200). The SDK synthesizes a bare
	// `{ type: "object" }` for them, which has no params to strip.
	const NO_INPUT_SCHEMA_TOOLS = new Set(["help", "cache_health", "settings_list", "ping"]);

	it("no served inputSchema contains an object that accepts unknown keys", async () => {
		const { tools } = await client.listTools();
		const offenders: string[] = [];
		for (const tool of tools) {
			if (tool.inputSchema === undefined || NO_INPUT_SCHEMA_TOOLS.has(tool.name)) continue;
			collectNonStrictObjectPaths(tool.inputSchema, tool.name, offenders);
		}
		expect(offenders, "these served input shapes silently strip unknown keys").toEqual([]);
	});

	it("run_tests declares strict nested shapes for tags and _sessionContext", async () => {
		const { tools } = await client.listTools();
		const runTests = tools.find((t) => t.name === "run_tests");
		const properties = ((runTests?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ??
			{}) as Record<string, { additionalProperties?: unknown }>;

		expect(properties.tags?.additionalProperties).toBe(false);
		expect(properties._sessionContext?.additionalProperties).toBe(false);
	});
});
