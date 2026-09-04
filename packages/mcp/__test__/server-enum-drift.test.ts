/**
 * Drift guard (issue #335): the MCP-SDK-side registrations in
 * `server.ts` re-declare every consolidated tool's action/kind
 * discriminator as a hand-written zod enum. When a tool core's
 * `Schema.Union` gains a new variant (e.g. `test`'s `for_tag`,
 * `inventory`'s `tag`) and the served enum in `server.ts` is not
 * updated in lockstep, a real MCP client can never reach the new
 * branch even though router-level tests exercise it directly — the
 * exact failure mode issue #335 reported.
 *
 * Each tool core exports a `<TOOL>_<DISCRIMINANT>S` const tuple next to
 * its `Schema.Union` input, with a compile-time assertion that the
 * tuple's element type matches the union's discriminant field type
 * exactly (both directions) — so an added/removed/renamed variant that
 * is not mirrored in the tuple fails to typecheck. `server.ts` now
 * builds each served `z.enum(...)` FROM that same tuple, so the
 * exported tuple is the single source of truth: this test's job is
 * simply to prove the served enum equals it (guarding against a
 * `server.ts` z.enum(...) call site being hand-edited back to a
 * hardcoded literal array that drifts again).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { buildMcpServer } from "../src/server.js";
import { HYPOTHESIS_ACTIONS } from "../src/tools/hypothesis.js";
import { INVENTORY_KINDS } from "../src/tools/inventory.js";
import { NOTE_ACTIONS } from "../src/tools/note.js";
import { TDD_BEHAVIOR_ACTIONS } from "../src/tools/tdd-behavior.js";
import { TDD_GOAL_ACTIONS } from "../src/tools/tdd-goal.js";
import { TDD_TASK_ACTIONS } from "../src/tools/tdd-task.js";
import { TEST_ACTIONS } from "../src/tools/test.js";
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
	client = new Client({ name: "server-enum-drift-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

const cases: ReadonlyArray<[tool: string, discriminant: string, expected: ReadonlyArray<string>]> = [
	["test", "action", TEST_ACTIONS],
	["inventory", "kind", INVENTORY_KINDS],
	["note", "action", NOTE_ACTIONS],
	["hypothesis", "action", HYPOTHESIS_ACTIONS],
	["tdd_task", "action", TDD_TASK_ACTIONS],
	["tdd_goal", "action", TDD_GOAL_ACTIONS],
	["tdd_behavior", "action", TDD_BEHAVIOR_ACTIONS],
];

describe("served discriminator enums stay in sync with tool-core discriminant sets", () => {
	it.each(cases)("%s's served %s enum equals the tool-core discriminant set", async (tool, discriminant, expected) => {
		const { tools } = await client.listTools();
		const found = tools.find((t) => t.name === tool);
		expect(found, `${tool} must be registered`).toBeDefined();
		const properties =
			(found?.inputSchema as { properties?: Record<string, { enum?: string[] }> } | undefined)?.properties ?? {};
		const servedEnum = properties[discriminant]?.enum ?? [];
		expect(new Set(servedEnum), `${tool}.${discriminant} served enum drifted from the tool-core set`).toEqual(
			new Set(expected),
		);
	});
});
