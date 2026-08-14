/**
 * Served-schema regression test for the `test` tool's `get` action
 * (issue #243, follow-up to #241).
 *
 * `full_name` is not file-qualified (Decision D20), so one run can carry
 * the same name in several modules. `DataReaderLive.getTestByFullName`
 * used `LIMIT 1` with no `ORDER BY` and no module predicate, so `get`
 * returned an arbitrary variant. The fix adds a `modulePath` predicate
 * and an ambiguity refusal — but neither reaches a real client unless the
 * served registration in `server.ts` declares AND forwards `modulePath`,
 * the same missed-sync failure mode issue #200 documented for run_tests.
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

const PROJECT = "served-ambiguous-proj";
const FULL_NAME = "Suite > shared";
const FIRST_MODULE = "src/aaa-first.test.ts";
const SECOND_MODULE = "src/zzz-second.test.ts";

let client: Client;

beforeAll(async () => {
	const ctx: McpContext = {
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "served-test-get-modulepath-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	// Two CURRENT test cases sharing a fullName across two modules — the
	// shape that actually makes the lookup ambiguous. (#241's decoy was
	// history-only, so the lookup only ever saw one candidate row.)
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("served-ambiguous-hash", { vitestVersion: "3.2.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "inv-served-ambiguous",
				project: PROJECT,
				settingsHash: "served-ambiguous-hash",
				timestamp: "2026-03-28T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "failed",
				duration: 100,
				total: 2,
				passed: 1,
				failed: 1,
				skipped: 0,
				scoped: false,
			});

			for (const [modulePath, state] of [
				[FIRST_MODULE, "passed"],
				[SECOND_MODULE, "failed"],
			] as const) {
				const fileId = yield* store.ensureFile(modulePath);
				const [moduleId] = yield* store.writeModules(runId, [
					{ fileId, relativeModuleId: modulePath, state, duration: 20 },
				]);
				yield* store.writeSuites(moduleId, [{ name: "Suite", fullName: "Suite", state }]);
				yield* store.writeTestCases(moduleId, [{ name: "shared", fullName: FULL_NAME, state, duration: 5 }]);
			}
		}),
	);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
});

const callGet = async (args: Record<string, unknown>) => {
	const result = await client.callTool({
		name: "test",
		arguments: { action: "get", fullName: FULL_NAME, project: PROJECT, ...args },
	});
	return {
		isError: result.isError ?? false,
		text: (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n"),
		structured: result.structuredContent as {
			found?: boolean;
			ambiguous?: boolean;
			candidateModules?: ReadonlyArray<string>;
			test?: { module?: string; state?: string };
		},
	};
};

describe("served test tool: get + modulePath", () => {
	it("declares modulePath on the served inputSchema", async () => {
		const { tools } = await client.listTools();
		const testTool = tools.find((t) => t.name === "test");
		const properties = (testTool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(properties)).toContain("modulePath");
	});

	it("refuses to guess when the fullName is ambiguous and no modulePath is given", async () => {
		const { structured, text } = await callGet({});
		expect(structured.found).toBe(false);
		expect(structured.ambiguous).toBe(true);
		expect(structured.candidateModules).toEqual([FIRST_MODULE, SECOND_MODULE]);
		// The rendered text has to name the candidates, or the agent cannot
		// self-correct without a second discovery call.
		expect(text).toContain(FIRST_MODULE);
		expect(text).toContain(SECOND_MODULE);
	});

	it("forwards modulePath through to the requested variant", async () => {
		const second = await callGet({ modulePath: SECOND_MODULE });
		expect(second.structured.found).toBe(true);
		expect(second.structured.test?.module).toBe(SECOND_MODULE);
		expect(second.structured.test?.state).toBe("failed");

		const first = await callGet({ modulePath: FIRST_MODULE });
		expect(first.structured.found).toBe(true);
		expect(first.structured.test?.module).toBe(FIRST_MODULE);
		expect(first.structured.test?.state).toBe("passed");
	});
});
