/**
 * Served-schema regression test for the `inventory` tool's `tag` kind
 * (issue #335).
 *
 * The tRPC input union in `tools/inventory.ts` has declared a `tag`
 * variant (`Schema.Literal("tag")`) since it shipped, but the
 * MCP-SDK-side registration in `server.ts` re-declares the discriminator
 * as a bare `z.enum(["project", "module", "suite", "session"])` — a
 * hand-synced mirror that was never updated when `tag` shipped. Because
 * every served input is strict, a real MCP client sending
 * `{ kind: "tag" }` gets an enum-validation rejection before the call
 * ever reaches the router; only router-level tests (inventory-tag.test.ts)
 * exercised the branch directly.
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

const PROJECT = "served-inventory-tag-proj";

let client: Client;

beforeAll(async () => {
	const ctx: McpContext = {
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "served-inventory-tag-schema-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("served-inventory-tag-hash", { vitestVersion: "3.2.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "inv-served-inventory-tag",
				project: PROJECT,
				settingsHash: "served-inventory-tag-hash",
				timestamp: "2026-03-28T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "passed",
				duration: 100,
				total: 1,
				passed: 1,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			const fileId = yield* store.ensureFile("src/served-inventory-tag.test.ts");
			const [moduleId] = yield* store.writeModules(runId, [
				{ fileId, relativeModuleId: "src/served-inventory-tag.test.ts", state: "passed", duration: 20 },
			]);
			yield* store.writeSuites(moduleId, [{ name: "Suite", fullName: "Suite", state: "passed" }]);
			yield* store.writeTestCases(moduleId, [
				{ name: "tagged", fullName: "Suite > tagged", state: "passed", duration: 5, tags: ["int"] },
			]);
		}),
	);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

describe("served inventory tool: tag kind", () => {
	it("declares tag in the served kind enum", async () => {
		const { tools } = await client.listTools();
		const inventoryTool = tools.find((t) => t.name === "inventory");
		expect(inventoryTool).toBeDefined();
		const properties =
			(inventoryTool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined)?.properties ??
			{};
		expect(properties.kind?.enum ?? []).toContain("tag");
	});

	it("reaches the tag router branch and returns the scoped tag result", async () => {
		const result = await client.callTool({
			name: "inventory",
			arguments: { kind: "tag", project: PROJECT },
		});
		expect(result.isError ?? false).toBe(false);
		const structured = result.structuredContent as {
			inventoryKind?: string;
			project?: string;
			count?: number;
			tags?: Array<{ tag: string; testCount: number }>;
		};
		expect(structured.inventoryKind).toBe("tag_scoped");
		expect(structured.project).toBe(PROJECT);
		expect(structured.count).toBe(1);
		expect(structured.tags?.[0]?.tag).toBe("int");
	});

	it("reaches the tag router branch unscoped and returns the tag_unscoped result", async () => {
		const result = await client.callTool({
			name: "inventory",
			arguments: { kind: "tag" },
		});
		expect(result.isError ?? false).toBe(false);
		const structured = result.structuredContent as { inventoryKind?: string };
		expect(structured.inventoryKind).toBe("tag_unscoped");
	});
});
