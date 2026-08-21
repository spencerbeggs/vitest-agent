/**
 * Served-schema regression tests for the `run_tests` tool (issue #200).
 *
 * The MCP-SDK-side registration in `server.ts` is hand-synced with the
 * tRPC input in `tools/run-tests.ts`. A missed sync is invisible to
 * router-level tests: the served `inputSchema` was non-strict, so an
 * unknown key (`testFiles` instead of `files`) was silently stripped
 * and the call fell through to an unfiltered full-workspace run — and
 * `tags` / `passWithNoTests` were accepted by the tRPC input but never
 * declared or forwarded by the served handler. These tests drive the
 * identical built server through an in-memory client so the *served*
 * contract — strictness, param forwarding, and scope echoing — is what
 * gets asserted.
 *
 * `.e2e.test.ts`: these calls run a real nested Vitest instance
 * in-process against a tiny isolated fixture project (never the
 * monorepo itself), so plain `.test.ts`'s 5s unit timeout is not
 * enough headroom — see `run-tests-console-leaks.e2e.test.ts` for the
 * same pattern.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OutputPipelineLive, ProjectDiscoveryTest } from "@vitest-agent/sdk";
import { Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { buildMcpServer } from "../src/server.js";
import { DataStoreTestLayer } from "./utils/layers.js";

// Tiny isolated fixture (its own vitest.config.ts, one test file) so a
// pre-fix "unfiltered run" during red-phase measurement stays fast
// instead of accidentally running the whole monorepo suite.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "console-leak-project");

const TestLayer = Layer.mergeAll(DataStoreTestLayer, OutputPipelineLive, ProjectDiscoveryTest.layer([]));
const testRuntime = ManagedRuntime.make(TestLayer);

let client: Client;
let xdgDir: string;

beforeAll(async () => {
	// Isolate the nested AgentPlugin's own DB writes (from running the
	// fixture's tests) into a throwaway XDG dir, same as the console-leak
	// e2e — the fixture run must not collide with the monorepo's data.db.
	xdgDir = mkdtempSync(join(tmpdir(), "va-run-tests-schema-xdg-"));
	process.env.XDG_DATA_HOME = xdgDir;

	const ctx: McpContext = {
		runtime: testRuntime as unknown as McpContext["runtime"],
		cwd: fixtureDir,
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "served-run-tests-schema-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
	await testRuntime.dispose();
	delete process.env.XDG_DATA_HOME;
	rmSync(xdgDir, { recursive: true, force: true });
});

describe("served run_tests tool schema", () => {
	it("rejects an unknown parameter (testFiles) instead of silently stripping it", { timeout: 120_000 }, async () => {
		const result = await client.callTool({
			name: "run_tests",
			arguments: {
				testFiles: ["leaky.test.ts"],
			},
		});
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		// The error should name the offending key AND the accepted params so
		// an agent can self-correct without re-reading the tool description.
		expect(text).toContain("testFiles");
		expect(text).toContain("Accepted params");
		expect(text).toContain("files");
	});

	it("declares tags and passWithNoTests, and forwards tags through to the tRPC handler", {
		timeout: 120_000,
	}, async () => {
		const tools = await client.listTools();
		const runTests = tools.tools.find((t) => t.name === "run_tests");
		const properties =
			(runTests?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
		expect(Object.keys(properties)).toContain("tags");
		expect(Object.keys(properties)).toContain("passWithNoTests");

		// A shell-metacharacter tag value is rejected by the tRPC input's
		// sanitizeTestArgs *only if the served handler actually forwards
		// `tags` through* — before the fix, `tags` was accepted by the tRPC
		// input but never declared or forwarded by the served handler, so
		// this value never reached sanitizeTestArgs and the call ran clean.
		const result = await client.callTool({
			name: "run_tests",
			arguments: { tags: { all: ["bad;tag"] } },
		});
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text).toContain("Unsafe argument rejected");
	});

	// Issue #243: `tags` and `_sessionContext` were plain `z.object`s
	// nested inside the strict top level, and a plain object STRIPS unknown
	// keys. `{ tags: { anyy: ["unit"] } }` therefore decoded to
	// `{ tags: {} }`, the tag filter evaporated, and the run silently
	// covered everything the agent believed it had filtered out.
	it("rejects an unknown key nested inside tags instead of emptying the filter", {
		timeout: 120_000,
	}, async () => {
		const result = await client.callTool({
			name: "run_tests",
			arguments: { tags: { anyy: ["unit"] } },
		});
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text).toContain("anyy");
		expect(text).toContain("Accepted params");
		// The accepted-param list must be the *nested* shape's, not the
		// top-level tool's, or it steers the agent to the wrong fix.
		expect(text).toContain("any");
	});

	it("rejects an unknown key nested inside _sessionContext", { timeout: 120_000 }, async () => {
		const result = await client.callTool({
			name: "run_tests",
			arguments: {
				_sessionContext: {
					chatId: "c",
					conversationId: "v",
					mainAgentId: "m",
					chat_id: "typo",
				},
			},
		});
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text).toContain("chat_id");
	});

	it("still accepts a well-formed nested tags object", { timeout: 120_000 }, async () => {
		// Guards against over-correcting: strictness must reject typos, not
		// the documented sub-filters.
		const result = await client.callTool({
			name: "run_tests",
			arguments: { tags: { any: ["never-used-tag"] } },
		});
		const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
		expect(text).not.toContain("Unrecognized parameter");
		expect(text).not.toContain("Input validation error");
	});

	it("returns a structured result whose scope echoes the resolved filters on success", {
		timeout: 120_000,
	}, async () => {
		const result = await client.callTool({
			name: "run_tests",
			arguments: { files: ["leaky.test.ts"] },
		});

		expect(result.isError).toBeFalsy();
		const structured = result.structuredContent as {
			kind?: string;
			scope?: { project: string | null; files: ReadonlyArray<string>; tags: unknown };
		};
		expect(structured.kind).toBe("ok");
		expect(structured.scope).toEqual({ project: null, files: ["leaky.test.ts"], tags: null });
	});
});
