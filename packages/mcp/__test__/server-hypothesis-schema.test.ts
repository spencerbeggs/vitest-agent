/**
 * Served-schema regression tests for the `hypothesis` tool.
 *
 * The MCP-SDK-side registrations in `server.ts` are hand-synced with the
 * tRPC inputs in `tools/`. A missed sync is invisible to router-level
 * tests: the tRPC procedure accepted `tddTaskId` for months while the
 * served schema neither declared nor forwarded it, making the
 * deterministic hypothesis binding unreachable from a real MCP client.
 * These tests drive the identical built server through an in-memory
 * client so the *served* contract is what gets asserted.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Effect, Layer, ManagedRuntime } from "effect";
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
	client = new Client({ name: "served-schema-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

describe("served hypothesis tool schema", () => {
	it("declares tddTaskId on the served inputSchema", async () => {
		const tools = await client.listTools();
		const hypothesis = tools.tools.find((t) => t.name === "hypothesis");
		expect(hypothesis).toBeDefined();
		const properties =
			(hypothesis?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
		expect(Object.keys(properties)).toContain("tddTaskId");
	});

	it("does not describe record as sessionId-first", async () => {
		const tools = await client.listTools();
		const hypothesis = tools.tools.find((t) => t.name === "hypothesis");
		// The description steers the model: record must lead with the
		// server-side resolution / tddTaskId, never "record (sessionId, ...)".
		expect(hypothesis?.description).not.toContain("action='record' (sessionId");
		expect(hypothesis?.description).toContain("tddTaskId");
	});

	it("describes validate with validatedAt marked optional, not a required positional", async () => {
		const tools = await client.listTools();
		const hypothesis = tools.tools.find((t) => t.name === "hypothesis");
		// validatedAt is now optional and server-defaulted — the description
		// must not list it as a bare required param alongside id/outcome.
		expect(hypothesis?.description).not.toContain("action='validate' (id, outcome, validatedAt)");
		expect(hypothesis?.description).toContain("validatedAt");
	});

	it("forwards a numeric-string tddTaskId end-to-end and binds to the task's session", async () => {
		const { sessionId, tddTaskId } = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sessionId = yield* store.writeSession({
					chatId: "cc-served-schema-a",
					project: "default",
					cwd: process.cwd(),
					agentKind: "subagent",
					agentType: "tdd-task",
					startedAt: "2026-07-22T00:00:00Z",
				});
				const tddTaskId = yield* store.writeTddTask({
					sessionId,
					goal: "served-schema goal",
					startedAt: "2026-07-22T00:00:01Z",
				});
				return { sessionId, tddTaskId };
			}),
		);

		// A real orchestrator stringifies numeric inputs — send "N", not N.
		const recorded = await client.callTool({
			name: "hypothesis",
			arguments: {
				action: "record",
				tddTaskId: String(tddTaskId),
				content: "served-schema: string tddTaskId must reach the tRPC resolution branch.",
			},
		});
		expect(recorded.isError ?? false).toBe(false);
		const structured = recorded.structuredContent as { action?: string; id?: number };
		expect(structured.action).toBe("record");
		expect(structured.id).toBeGreaterThan(0);

		const listed = await client.callTool({
			name: "hypothesis",
			arguments: { action: "list", sessionId },
		});
		const listStructured = listed.structuredContent as { count?: number };
		expect(listStructured.count).toBe(1);
	});

	it("declares validatedAt as optional on the served inputSchema", async () => {
		const tools = await client.listTools();
		const hypothesis = tools.tools.find((t) => t.name === "hypothesis");
		expect(hypothesis).toBeDefined();
		const schema = hypothesis?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
		expect(Object.keys(schema.properties ?? {})).toContain("validatedAt");
		expect(schema.required ?? []).not.toContain("validatedAt");
	});

	it("validates a hypothesis end to end without a validatedAt argument", async () => {
		const { sessionId, hypothesisId } = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sessionId = yield* store.writeSession({
					chatId: "cc-served-schema-validate-no-at",
					project: "default",
					cwd: process.cwd(),
					agentKind: "subagent",
					agentType: "tdd-task",
					startedAt: "2026-07-22T00:00:00Z",
				});
				const hypothesisId = yield* store.writeHypothesis({
					sessionId,
					content: "served-schema: validate must work without validatedAt over a real client call.",
				});
				return { sessionId, hypothesisId };
			}),
		);

		const validated = await client.callTool({
			name: "hypothesis",
			arguments: { action: "validate", id: hypothesisId, outcome: "confirmed" },
		});
		expect(validated.isError ?? false).toBe(false);
		const structured = validated.structuredContent as { action?: string };
		expect(structured.action).toBe("validate");

		const listed = await client.callTool({
			name: "hypothesis",
			arguments: { action: "list", sessionId },
		});
		const listStructured = listed.structuredContent as {
			hypotheses?: { id: number; validatedAt: string | null }[];
		};
		const row = listStructured.hypotheses?.find((h) => h.id === hypothesisId);
		expect(row?.validatedAt).not.toBeNull();
	});
});
