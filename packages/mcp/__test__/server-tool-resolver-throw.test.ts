/**
 * `safeRegisterTool` catch-all (issue #191, sub-item A).
 *
 * The MCP SDK's own `CallToolRequestSchema` handler already prevents a
 * tool resolver's throw from crashing the process, but its fallback
 * (`createToolError`) returns a bare `content[].text` string with no
 * `structuredContent`. This test drives the *served* `buildMcpServer`
 * through an in-memory client with a deliberately broken `ctx.runtime`
 * so an arbitrary tool's resolver throws, and asserts the tool result
 * carries the structured `UnexpectedToolError` envelope instead.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpContext } from "../src/context.js";
import { createCurrentSessionIdRef, createSessionContextRef } from "../src/context.js";
import { buildMcpServer } from "../src/server.js";

let client: Client;

beforeAll(async () => {
	const brokenRuntime = {
		runPromise: () => {
			throw new Error("boom: injected resolver failure");
		},
	} as unknown as McpContext["runtime"];
	const ctx: McpContext = {
		runtime: brokenRuntime,
		cwd: process.cwd(),
		currentSessionId: createCurrentSessionIdRef(),
		sessionContext: createSessionContextRef(),
	};
	const server = buildMcpServer(ctx);
	client = new Client({ name: "tool-resolver-throw-test", version: "0.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
	await client.close();
});

describe("safeRegisterTool catch-all", () => {
	it("returns a structured UnexpectedToolError envelope instead of the SDK's generic text error", async () => {
		const result = await client.callTool({ name: "cache_health", arguments: {} });
		expect(result.isError).toBe(true);
		const structured = result.structuredContent as { ok?: boolean; error?: { _tag?: string; tool?: string } };
		expect(structured?.ok).toBe(false);
		expect(structured?.error?._tag).toBe("UnexpectedToolError");
		expect(structured?.error?.tool).toBe("cache_health");
	});
});
