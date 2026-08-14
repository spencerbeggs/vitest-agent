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
