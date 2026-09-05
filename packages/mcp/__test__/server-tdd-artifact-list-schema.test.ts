/**
 * Served-schema regression test for the `tdd_artifact_list` tool (#363
 * regression). `TddArtifactRow` gained a `suite: "vitest" | "bats"` field
 * (packages/sdk/src/services/DataReader.ts), but the served output schema
 * in `tools/tdd-artifact.ts` was not updated — a real MCP client call fails
 * server-side output validation with "Unrecognized key: suite" because the
 * SDK's `safeParseAsync(outputSchema, structuredContent)` step (only
 * exercised by a real `client.callTool`, never by a router-level
 * `caller.tdd_artifact_list(...)` call) rejects the extra key.
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

describe("served tdd_artifact_list tool schema", () => {
	it('succeeds and echoes suite:"bats" for a bats-suite artifact over a real client call', async () => {
		const { tddTaskId } = await testRuntime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sessionId = yield* store.writeSession({
					chatId: "cc-served-schema-artifact-suite",
					project: "default",
					cwd: process.cwd(),
					agentKind: "subagent",
					agentType: "tdd-task",
					startedAt: "2026-09-05T00:00:00Z",
				});
				const tddTaskId = yield* store.writeTddTask({
					sessionId,
					goal: "served-schema artifact suite goal",
					startedAt: "2026-09-05T00:00:01Z",
				});
				const phase = yield* store.writeTddPhase({
					tddTaskId,
					phase: "red",
					startedAt: "2026-09-05T00:00:02Z",
				});
				yield* store.writeTddArtifact({
					phaseId: phase.id,
					artifactKind: "test_failed_run",
					recordedAt: "2026-09-05T00:00:03Z",
					suite: "bats",
				});
				return { tddTaskId };
			}),
		);

		const result = await client.callTool({
			name: "tdd_artifact_list",
			arguments: { tddTaskId },
		});
		expect(result.isError ?? false).toBe(false);
		const structured = result.structuredContent as { count?: number; artifacts?: { suite?: string }[] };
		expect(structured.count).toBe(1);
		expect(structured.artifacts?.[0]?.suite).toBe("bats");
	});
});
