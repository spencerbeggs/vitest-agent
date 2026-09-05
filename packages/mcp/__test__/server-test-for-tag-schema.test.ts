/**
 * Served-schema regression test for the `test` tool's `for_tag` action
 * (issue #335).
 *
 * The tRPC input union in `tools/test.ts` has declared a `for_tag` variant
 * (`Schema.Literal("for_tag")`) since the tool was added, and the router
 * dispatches it via `Match.discriminatorsExhaustive`. But the MCP-SDK-side
 * registration in `server.ts` re-declares the discriminator as a bare
 * `z.enum(["list", "get", "for_file"])` — a hand-synced mirror that was
 * never updated when `for_tag` shipped. Because every served input is
 * strict, a real MCP client sending `{ action: "for_tag", tag: "int" }`
 * gets an enum-validation rejection before the call ever reaches the
 * router; only router-level tests (test-for-tag.test.ts) exercised the
 * branch directly.
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

const PROJECT = "served-for-tag-proj";

let client: Client;

beforeAll(async () => {
	const ctx: McpContext = {
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "served-test-for-tag-schema-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("served-for-tag-hash", { vitestVersion: "3.2.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "inv-served-for-tag",
				project: PROJECT,
				settingsHash: "served-for-tag-hash",
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
			const fileId = yield* store.ensureFile("src/served-for-tag.test.ts");
			const [moduleId] = yield* store.writeModules(runId, [
				{ fileId, relativeModuleId: "src/served-for-tag.test.ts", state: "passed", duration: 20 },
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

describe("served test tool: for_tag action", () => {
	it("declares for_tag in the served action enum", async () => {
		const { tools } = await client.listTools();
		const testTool = tools.find((t) => t.name === "test");
		expect(testTool).toBeDefined();
		const properties =
			(testTool?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined)?.properties ?? {};
		expect(properties.action?.enum ?? []).toContain("for_tag");
	});

	it("declares tag as an accepted parameter", async () => {
		const { tools } = await client.listTools();
		const testTool = tools.find((t) => t.name === "test");
		const properties =
			(testTool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
		expect(Object.keys(properties)).toContain("tag");
	});

	it("reaches the for_tag router branch and returns the grouped tag result", async () => {
		const result = await client.callTool({
			name: "test",
			arguments: { action: "for_tag", tag: "int", project: PROJECT },
		});
		expect(result.isError ?? false).toBe(false);
		const structured = result.structuredContent as {
			action?: string;
			tag?: string;
			count?: number;
			groups?: Array<{ project: string; tests: Array<{ fullName: string }> }>;
		};
		expect(structured.action).toBe("for_tag");
		expect(structured.tag).toBe("int");
		expect(structured.count).toBe(1);
		expect(structured.groups?.[0]?.project).toBe(PROJECT);
		expect(structured.groups?.[0]?.tests?.[0]?.fullName).toBe("Suite > tagged");
	});
});
