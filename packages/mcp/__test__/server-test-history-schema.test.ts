/**
 * Served-schema regression test for the `test_history` tool (issue #212).
 *
 * The MCP-SDK-side registration in `server.ts` is hand-synced with the
 * tRPC input in `tools/history.ts`. testName/modulePath/limit were added
 * to the tRPC input and to `DataReaderLive.getHistory`'s SQL predicates,
 * but neither reaches a real client until the served schema declares and
 * forwards them too — the same missed-sync failure mode issue #200
 * documented for run_tests.
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
	client = new Client({ name: "served-test-history-schema-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

describe("served test_history tool schema", () => {
	it("declares testName, modulePath, and limit on the served inputSchema", async () => {
		const tools = await client.listTools();
		const testHistory = tools.tools.find((t) => t.name === "test_history");
		expect(testHistory).toBeDefined();
		const properties = (testHistory?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(properties)).toContain("testName");
		expect(Object.keys(properties)).toContain("modulePath");
		expect(Object.keys(properties)).toContain("limit");
	});

	it("forwards testName through to a real single-test result", async () => {
		await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				yield* store.writeSettings("served-history-hash", { vitestVersion: "3.2.0" }, {});
				const runId = yield* store.writeRun({
					invocationId: "inv-served-history",
					project: "served-history-proj",
					settingsHash: "served-history-hash",
					timestamp: "2026-03-26T00:00:00.000Z",
					commitSha: null,
					branch: null,
					reason: "passed",
					duration: 100,
					total: 2,
					passed: 2,
					failed: 0,
					skipped: 0,
					scoped: false,
				});
				yield* store.writeHistory(
					"served-history-proj",
					"Suite > one",
					"src/a.test.ts",
					runId,
					"2026-03-26T00:00:00.000Z",
					"passed",
					10,
					false,
					0,
					null,
				);
				yield* store.writeHistory(
					"served-history-proj",
					"Suite > two",
					"src/b.test.ts",
					runId,
					"2026-03-26T00:00:00.000Z",
					"passed",
					10,
					false,
					0,
					null,
				);
			}),
		);

		const result = await client.callTool({
			name: "test_history",
			arguments: { project: "served-history-proj", testName: "Suite > one" },
		});
		expect(result.isError ?? false).toBe(false);
		const structured = result.structuredContent as { history?: { tests?: Array<{ fullName?: string }> } };
		expect(structured.history?.tests).toHaveLength(1);
		expect(structured.history?.tests?.[0]?.fullName).toBe("Suite > one");
	});

	// Issue #243: the served `limit` was `z.coerce.number()`, so 0 / -1 /
	// "abc"(→NaN) validated fine and flowed into the SQL `rn <= limit`
	// predicate, returning an empty history that reads exactly like "this
	// test has never run".
	it.each([0, -1, 2.5, "abc"])("rejects limit=%s instead of returning an empty history", async (limit) => {
		const result = await client.callTool({
			name: "test_history",
			arguments: { project: "served-history-proj", limit },
		});
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text).toMatch(/limit/i);
	});

	it("still accepts a positive integer limit", async () => {
		const result = await client.callTool({
			name: "test_history",
			arguments: { project: "served-history-proj", limit: 3 },
		});
		expect(result.isError ?? false).toBe(false);
	});
});
