/**
 * Unit tests for test({ action: "annotations" }) and
 * test({ action: "artifacts" }) — the MCP read surface over the
 * `test_annotations` / `test_artifacts` tables (Vitest 5).
 *
 * Both actions return descriptors: an attachment carries its
 * `contentType`, `path` and `byteSize`, and only ever carries a `body`
 * when the writer already stored one under the 64 KiB inline cap. A
 * body over the cap is dropped at write time, so the read surface can
 * never hand an agent a wall of bytes.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataStore, OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { buildMcpServer } from "../src/server.js";
import { formatTestMarkdown } from "../src/tools/test.js";
import { DataStoreTestLayer } from "./utils/layers.js";

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

const makeCaller = () => {
	const factory = createCallerFactory(appRouter);
	return factory({
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	});
};

afterAll(async () => {
	await testRuntime.dispose();
});

const PROJECT = "anno-proj";
const MODULE = "src/anno.test.ts";
const FULL_NAME = "anno > works";
const ERROR_PROJECT = "anno-errors";
const ERROR_MODULE = "src/failing.test.ts";
const ERROR_FULL_NAME = "failing > blows up";

const seedFixture = async () => {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("anno-hash", { vitestVersion: "5.0.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "anno-inv",
				project: PROJECT,
				settingsHash: "anno-hash",
				timestamp: "2026-09-07T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "passed" as const,
				duration: 10,
				total: 1,
				passed: 1,
				failed: 0,
				skipped: 0,
				scoped: false,
			});
			const fileId = yield* store.ensureFile(MODULE);
			const [moduleId] = yield* store.writeModules(runId, [
				{ fileId, relativeModuleId: MODULE, state: "passed", duration: 5 },
			]);
			const [testCaseId] = yield* store.writeTestCases(moduleId, [
				{ name: "works", fullName: FULL_NAME, state: "passed" },
			]);
			yield* store.writeAnnotations(runId, [
				{
					testCaseId,
					type: "issues",
					message: "known slow under CI",
					locationFile: MODULE,
					locationLine: 12,
					locationColumn: 3,
					attachments: [],
				},
			]);
			const big = "x".repeat(70_000);
			yield* store.writeArtifacts(runId, [
				{
					testCaseId,
					type: "my-pkg:trace",
					message: "trace captured",
					data: JSON.stringify({ spans: 2 }),
					attachments: [
						{ contentType: "image/png", path: ".vitest/attachments/s.png", byteSize: 2048 },
						{ contentType: "text/plain", body: big, bodyEncoding: "utf-8", byteSize: big.length },
						{ contentType: "text/plain", body: "hello", bodyEncoding: "utf-8", byteSize: 5 },
					],
				},
			]);
		}),
	);
};

/**
 * A second project whose latest run carries one test-scoped error on an
 * annotated test and one module-scoped error with no test at all — the
 * two halves of the `test_errors` annotations contract.
 */
const seedErrorFixture = async () => {
	await testRuntime.runPromise(
		Effect.gen(function* () {
			const store = yield* DataStore;
			yield* store.writeSettings("anno-err-hash", { vitestVersion: "5.0.0" }, {});
			const runId = yield* store.writeRun({
				invocationId: "anno-err-inv",
				project: ERROR_PROJECT,
				settingsHash: "anno-err-hash",
				timestamp: "2026-09-07T00:00:00.000Z",
				commitSha: null,
				branch: null,
				reason: "failed" as const,
				duration: 10,
				total: 1,
				passed: 0,
				failed: 1,
				skipped: 0,
				scoped: false,
			});
			const fileId = yield* store.ensureFile(ERROR_MODULE);
			const [moduleId] = yield* store.writeModules(runId, [
				{ fileId, relativeModuleId: ERROR_MODULE, state: "failed", duration: 5 },
			]);
			const [testCaseId] = yield* store.writeTestCases(moduleId, [
				{ name: "blows up", fullName: ERROR_FULL_NAME, state: "failed" },
			]);
			yield* store.writeAnnotations(runId, [
				{
					testCaseId,
					type: "issues",
					message: "flaky under load",
					locationFile: ERROR_MODULE,
					locationLine: 4,
					locationColumn: 1,
					attachments: [],
				},
			]);
			yield* store.writeErrors(runId, [
				{ testCaseId, scope: "test", name: "AssertionError", message: "expected 3 to equal 2" },
				{ moduleId, scope: "module", name: "SyntaxError", message: "unexpected token" },
			]);
		}),
	);
};

beforeAll(async () => {
	await seedFixture();
	await seedErrorFixture();
});

describe("test({ action: 'annotations' })", () => {
	it("returns an empty, counted payload for a test that recorded nothing", async () => {
		const caller = makeCaller();
		const result = await caller.test({ action: "annotations", fullName: "anno > absent", project: PROJECT });
		expect(result).toEqual({
			action: "annotations",
			project: PROJECT,
			fullName: "anno > absent",
			count: 0,
			annotations: [],
		});
	});

	it("returns the recorded annotation with its type, message and location", async () => {
		const caller = makeCaller();
		const result = await caller.test({ action: "annotations", fullName: FULL_NAME, project: PROJECT });
		if (result.action !== "annotations") throw new Error("expected the annotations variant");
		expect(result.count).toBe(1);
		expect(result.annotations[0]?.type).toBe("issues");
		expect(result.annotations[0]?.message).toBe("known slow under CI");
		expect(result.annotations[0]?.location).toEqual({ file: MODULE, line: 12, column: 3 });
	});

	it("scopes to a modulePath, returning nothing for a module the test does not live in", async () => {
		const caller = makeCaller();
		const result = await caller.test({
			action: "annotations",
			fullName: FULL_NAME,
			project: PROJECT,
			modulePath: "src/elsewhere.test.ts",
		});
		if (result.action !== "annotations") throw new Error("expected the annotations variant");
		expect(result.count).toBe(0);
	});

	it("returns the row when the modulePath matches", async () => {
		const caller = makeCaller();
		const result = await caller.test({
			action: "annotations",
			fullName: FULL_NAME,
			project: PROJECT,
			modulePath: MODULE,
		});
		if (result.action !== "annotations") throw new Error("expected the annotations variant");
		expect(result.count).toBe(1);
	});
});

describe("test({ action: 'artifacts' })", () => {
	it("returns attachment descriptors carrying path and byteSize and no inline body", async () => {
		const caller = makeCaller();
		const result = await caller.test({ action: "artifacts", fullName: FULL_NAME, project: PROJECT });
		if (result.action !== "artifacts") throw new Error("expected the artifacts variant");
		expect(result.count).toBe(1);
		const artifact = result.artifacts[0];
		expect(artifact?.type).toBe("my-pkg:trace");
		expect(artifact?.data).toBe(JSON.stringify({ spans: 2 }));
		expect(artifact?.attachments).toHaveLength(3);
		expect(artifact?.attachments[0]?.path).toBe(".vitest/attachments/s.png");
		expect(artifact?.attachments[0]?.byteSize).toBe(2048);
		expect(artifact?.attachments[0]?.body).toBeUndefined();
		// The over-cap body was dropped at write time; only its size survives.
		expect(artifact?.attachments[1]?.byteSize).toBe(70_000);
		expect(artifact?.attachments[1]?.body).toBeUndefined();
		// An under-cap body survives, and its encoding comes back with it so
		// the agent knows whether the string is base64.
		expect(artifact?.attachments[2]?.body).toBe("hello");
		expect(artifact?.attachments[2]?.bodyEncoding).toBe("utf-8");
	});

	it("returns an empty, counted payload for a test that recorded nothing", async () => {
		const caller = makeCaller();
		const result = await caller.test({ action: "artifacts", fullName: "anno > absent", project: PROJECT });
		expect(result).toEqual({
			action: "artifacts",
			project: PROJECT,
			fullName: "anno > absent",
			count: 0,
			artifacts: [],
		});
	});
});

describe("test_errors carries the failing test's annotations", () => {
	it("attaches the recorded annotations to the error row and leaves other scopes empty", async () => {
		const caller = makeCaller();
		const result = await caller.test_errors({ project: ERROR_PROJECT });
		expect(result.count).toBe(2);
		const testScoped = result.errors.find((e) => e.scope === "test");
		expect(testScoped?.annotations).toEqual([
			{ type: "issues", message: "flaky under load", location: { file: ERROR_MODULE, line: 4, column: 1 } },
		]);
		const moduleScoped = result.errors.find((e) => e.scope === "module");
		expect(moduleScoped?.annotations).toEqual([]);
	});
});

describe("the served `test` tool reaches both new actions", () => {
	const connect = async () => {
		const server = buildMcpServer({
			runtime: testRuntime as unknown as McpContext["runtime"],
			cwd: process.cwd(),
			currentSessionId: createCurrentSessionIdRef(),
			sessionContext: createSessionContextRef(),
		});
		const client = new Client({ name: "tools-test-artifacts", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		return client;
	};

	it("returns a valid structuredContent payload for action='artifacts'", async () => {
		const client = await connect();
		try {
			const result = await client.callTool({
				name: "test",
				arguments: { action: "artifacts", fullName: FULL_NAME, project: PROJECT },
			});
			const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
			expect(result.isError, text).toBeFalsy();
			expect((result.structuredContent as { count?: number }).count).toBe(1);
		} finally {
			await client.close();
		}
	});

	it("returns a valid structuredContent payload for action='annotations'", async () => {
		const client = await connect();
		try {
			const result = await client.callTool({
				name: "test",
				arguments: { action: "annotations", fullName: FULL_NAME, project: PROJECT },
			});
			const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
			expect(result.isError, text).toBeFalsy();
			expect((result.structuredContent as { count?: number }).count).toBe(1);
		} finally {
			await client.close();
		}
	});
});

describe("formatTestMarkdown for the two new actions", () => {
	it("renders an empty-state line naming the test when no annotations exist", () => {
		const text = formatTestMarkdown({
			action: "annotations",
			project: PROJECT,
			fullName: FULL_NAME,
			count: 0,
			annotations: [],
		});
		expect(text).toBe(`No test annotations recorded for \`${FULL_NAME}\`.`);
	});

	it("renders an empty-state line naming the test when no artifacts exist", () => {
		const text = formatTestMarkdown({
			action: "artifacts",
			project: PROJECT,
			fullName: FULL_NAME,
			count: 0,
			artifacts: [],
		});
		expect(text).toBe(`No test artifacts recorded for \`${FULL_NAME}\`.`);
	});

	it("renders a type/message/location/attachments table for annotations", () => {
		const text = formatTestMarkdown({
			action: "annotations",
			project: PROJECT,
			fullName: FULL_NAME,
			count: 1,
			annotations: [
				{
					id: 1,
					type: "issues",
					message: "known slow under CI",
					location: { file: MODULE, line: 12, column: 3 },
					attachments: [{ contentType: "image/png", path: ".vitest/attachments/s.png", byteSize: 2048 }],
				},
			],
		});
		expect(text).toContain("| Type | Message | Location | Attachments |");
		expect(text).toContain("issues");
		expect(text).toContain(`${MODULE}:12:3`);
		expect(text).toContain(".vitest/attachments/s.png");
	});

	it("flattens and truncates a long, pipe-bearing message so the table row survives", () => {
		const text = formatTestMarkdown({
			action: "annotations",
			project: PROJECT,
			fullName: FULL_NAME,
			count: 1,
			annotations: [{ id: 1, type: "notice", message: `a|b\nc${"x".repeat(300)}`, attachments: [] }],
		});
		const row = text.split("\n").at(-1) ?? "";
		expect(row).toContain("a\\|b c");
		expect(row).toContain("… (truncated)");
		// The raw pipe is backslash-escaped, so it stays inside its cell
		// rather than opening a sixth column.
		expect(row.startsWith("| notice | a\\|b c")).toBe(true);
		expect(row.endsWith(" | — | — |")).toBe(true);
	});

	it("renders a type/message/location/attachments table for artifacts", () => {
		const text = formatTestMarkdown({
			action: "artifacts",
			project: PROJECT,
			fullName: FULL_NAME,
			count: 1,
			artifacts: [
				{
					id: 1,
					type: "my-pkg:trace",
					message: null,
					data: JSON.stringify({ spans: 2 }),
					attachments: [],
				},
			],
		});
		expect(text).toContain("| Type | Message | Location | Attachments |");
		expect(text).toContain("my-pkg:trace");
	});
});
