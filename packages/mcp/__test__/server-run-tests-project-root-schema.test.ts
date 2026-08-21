/**
 * Served-schema regression test for `run_tests`'s `projectRoot` param
 * (issue #252). The MCP-SDK-side registration in `server.ts` is hand-synced
 * with the tRPC input in `tools/run-tests.ts` — a field declared only on
 * one side is either rejected at the door (served schema strips it as an
 * unknown key) or silently dropped (tRPC never receives it), exactly the
 * class of bug issue #246 fixed for `hypothesis`'s `tddTaskId`. This test
 * drives the identical built server through an in-memory client so the
 * *served* contract — not just the tRPC router — is what gets asserted.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { DataStoreTestLayer } from "@vitest-agent/sdk/testing";
import { Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { buildMcpServer } from "../src/server.js";

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

describe("served run_tests tool schema — projectRoot (issue #252)", () => {
	it("declares projectRoot on the served inputSchema", async () => {
		const tools = await client.listTools();
		const runTests = tools.tools.find((t) => t.name === "run_tests");
		expect(runTests).toBeDefined();
		const properties =
			(runTests?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
		expect(Object.keys(properties)).toContain("projectRoot");
	});

	it("documents projectRoot in the served tool description", async () => {
		const tools = await client.listTools();
		const runTests = tools.tools.find((t) => t.name === "run_tests");
		expect(runTests?.description).toContain("projectRoot");
	});

	it("still rejects a genuinely unknown key alongside the new param", async () => {
		const result = await client.callTool({
			name: "run_tests",
			arguments: { projectRoot: process.cwd(), bogusKey: "nope" },
		});
		expect(result.isError).toBe(true);
	});
});
