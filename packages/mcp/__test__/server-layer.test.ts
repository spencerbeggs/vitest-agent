/**
 * `ServerLayer` end-to-end over the in-process stdio harness: the
 * initialize handshake, `tools/list` annotations, the `tools/call` result,
 * strict unknown-key rejection (version-dependent wire shape), and a
 * defect's scrubbed `isError` text (the detail stays on stderr).
 */

import { McpToolkit } from "@effected/mcp";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";
import type { JsonRpcMessage, McpHarness } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

const boomTool = Tool.make("boom", {
	description: "Throwaway tool whose handler dies.",
	success: Schema.Struct({ never: Schema.String }),
});
const BoomLayer = McpToolkit.layer(Toolkit.make(boomTool)).pipe(
	Layer.provide(Toolkit.make(boomTool).toLayer({ boom: () => Effect.die(new Error("kaboom")) })),
);

class DeclaredFailure extends Schema.TaggedError<DeclaredFailure>()("DeclaredFailure", { message: Schema.String }) {}
const failingTool = Tool.make("fails", {
	description: "Throwaway tool with a declared failure.",
	success: Schema.Struct({ never: Schema.String }),
	failure: DeclaredFailure,
});
const identifiedTool = Tool.make("identified", {
	description: "Throwaway tool whose parameters carry an identifier annotation.",
	parameters: Schema.Struct({ project: Schema.optionalKey(Schema.String) }).annotate({
		identifier: "IdentifiedParams",
	}),
	success: Schema.Struct({ ok: Schema.Boolean }),
});
const ExtraKit = Toolkit.make(failingTool, identifiedTool);
const ExtraLayer = McpToolkit.layer(ExtraKit).pipe(
	Layer.provide(
		ExtraKit.toLayer({
			fails: () => Effect.fail(new DeclaredFailure({ message: "declared boom" })),
			identified: () => Effect.succeed({ ok: true }),
		}),
	),
);

const withHarness = <A>(
	f: (harness: McpHarness) => Effect.Effect<A>,
	options?: Parameters<typeof makeHarness>[0],
): Promise<A> => Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

const jsonError = (message: JsonRpcMessage): { code: number; message: string } =>
	message.error as { code: number; message: string };

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

describe("ServerLayer over stdio", () => {
	it("initialize returns serverInfo.name vitest-agent and the newest protocol", async () => {
		const result = await withHarness((h) => h.initialize());
		const body = result.result as { serverInfo: { name: string }; protocolVersion: string };
		expect(body.serverInfo.name).toBe("vitest-agent");
		expect(body.protocolVersion).toBe("2025-11-25");
	});

	it("a client offering 2025-06-18 gets 2025-06-18", async () => {
		const result = await withHarness((h) => h.initialize("2025-06-18"));
		expect((result.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
	});

	it("an unknown protocol version falls back to 2025-11-25", async () => {
		const result = await withHarness((h) => h.initialize("1999-01-01"));
		expect((result.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
	});

	it("tools/list contains ping and help annotated read-only, non-destructive, closed-world", async () => {
		const tools = await withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));
		const names = tools.map((t) => t.name);
		expect(names).toContain("ping");
		expect(names).toContain("help");
		for (const name of ["ping", "help"]) {
			const tool = tools.find((t) => t.name === name) as { annotations: Record<string, unknown> };
			expect(tool.annotations.readOnlyHint, `${name} readOnlyHint`).toBe(true);
			expect(tool.annotations.destructiveHint, `${name} destructiveHint`).toBe(false);
			expect(tool.annotations.openWorldHint, `${name} openWorldHint`).toBe(false);
			expect(tool.annotations.idempotentHint, `${name} idempotentHint`).toBe(true);
		}
	});

	it("served schema for ping is a strict object", async () => {
		const tools = await withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));
		const ping = tools.find((t) => t.name === "ping") as { inputSchema: Record<string, unknown> };
		expect(ping.inputSchema.type).toBe("object");
		expect(ping.inputSchema.additionalProperties).toBe(false);
	});

	it("tools/call ping {} returns structuredContent pong with a null distribution for a direct launch", async () => {
		const result = (await withHarness((h) =>
			h.initialize().pipe(Effect.andThen(h.callTool("ping", {}))),
		)) as CallToolResult;
		expect(result.isError).toBe(false);
		expect(result.structuredContent).toEqual({ message: "pong", distribution: null });
	});

	it("tools/call ping reports the carrier distribution main.ts provides", async () => {
		const distribution = { name: "@vitest-agent/plugin", version: "9.9.9" };
		const result = (await withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool("ping", {}))), {
			distribution,
		})) as CallToolResult;
		expect(result.structuredContent).toEqual({ message: "pong", distribution });
	});

	it("tools/call help {} carries helpText in structuredContent", async () => {
		const result = (await withHarness((h) =>
			h.initialize().pipe(Effect.andThen(h.callTool("help", {}))),
		)) as CallToolResult;
		expect(result.isError).toBe(false);
		expect(result.structuredContent?.helpText).toContain("# vitest-agent MCP Tools");
	});

	it("tools/call ping { bogus: 1 } on 2025-11-25 is an isError result naming the key", async () => {
		const result = (await withHarness((h) =>
			h.initialize().pipe(Effect.andThen(h.callTool("ping", { bogus: 1 }))),
		)) as CallToolResult;
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Unrecognized parameter(s): bogus");
	});

	it("tools/call ping { bogus: 1 } on 2025-06-18 is a JSON-RPC -32602 error with the same message", async () => {
		const response = await withHarness(
			(h) =>
				h.initialize().pipe(Effect.andThen(h.sendRequest("tools/call", { name: "ping", arguments: { bogus: 1 } }))),
			{ protocol: McpProtocol.v2025_06_18 },
		);
		expect(response.result).toBeUndefined();
		expect(jsonError(response).code).toBe(-32602);
		expect(jsonError(response).message).toContain("Unrecognized parameter(s): bogus");
	});

	it("a handler that dies returns core's scrubbed isError text and logs the defect on stderr", async () => {
		const { result, stderr } = await withHarness(
			(h) =>
				Effect.gen(function* () {
					yield* h.initialize();
					const result = (yield* h.callTool("boom", {})) as CallToolResult;
					return { result, stderr: yield* h.stderrSoFar };
				}),
			{ extraLayers: [BoomLayer] },
		);
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
		expect(result.content[0]?.text).toBe("Tool execution failed due to an internal server error.");
		expect(result.content[0]?.text).not.toContain("kaboom");
		expect(stderr).toContain("kaboom");
	});

	it("keeps stderr silent for the happy paths and never leaks JSON-RPC frames there", async () => {
		const { stderr, boomStderr } = await withHarness(
			(h) =>
				Effect.gen(function* () {
					yield* h.initialize();
					yield* h.listTools;
					yield* h.callTool("ping", {});
					yield* h.callTool("help", {});
					yield* h.callTool("ping", { bogus: 1 });
					const stderr = yield* h.stderrSoFar;
					yield* h.callTool("boom", {});
					const boomStderr = yield* h.stderrSoFar;
					return { stderr, boomStderr };
				}),
			{ extraLayers: [BoomLayer] },
		);
		expect(stderr).toBe("");
		expect(boomStderr).toContain("kaboom");
		expect(boomStderr).not.toContain("jsonrpc");
	});

	it("a declared failure surfaces as isError with the error message and no structuredContent (upstream parity)", async () => {
		const result = (await withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool("fails", {}))), {
			extraLayers: [ExtraLayer],
		})) as CallToolResult;
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
		expect(result.content[0]?.text).toBe("declared boom");
	});

	it("an identifier-annotated parameters schema registers and lists as a strict object", async () => {
		const { tools, result } = await withHarness(
			(h) =>
				Effect.gen(function* () {
					yield* h.initialize();
					const tools = yield* h.listTools;
					const result = (yield* h.callTool("identified", { project: "x" })) as CallToolResult;
					return { tools, result };
				}),
			{ extraLayers: [ExtraLayer] },
		);
		const tool = tools.find((t) => t.name === "identified") as { inputSchema: Record<string, unknown> };
		expect(tool.inputSchema.type).toBe("object");
		expect(tool.inputSchema.additionalProperties).toBe(false);
		expect(tool.inputSchema.$ref).toBeUndefined();
		expect(result.structuredContent).toEqual({ ok: true });
	});

	it("ping lists an outputSchema even though PingResult carries an identifier", async () => {
		const tools = await withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));
		const ping = tools.find((t) => t.name === "ping") as { outputSchema?: Record<string, unknown> };
		expect(ping.outputSchema?.type).toBe("object");
		expect(ping.outputSchema?.$ref).toBeUndefined();
	});

	it("routes Effect logs to stderr under the default logger so stdout stays pure JSON-RPC", async () => {
		// `McpHarness` dies the wait on any stdout line that is not JSON-RPC, so
		// reaching the assertions already proves the wire stayed clean.
		const { consoleLog, consoleError } = await withHarness(
			(h) =>
				Effect.gen(function* () {
					yield* h.initialize();
					yield* h.callTool("boom", {});
					return { consoleLog: yield* h.consoleLogSoFar, consoleError: yield* h.stderrSoFar };
				}),
			{ extraLayers: [BoomLayer] },
		);
		expect(consoleLog).toEqual([]);
		expect(consoleError).toContain("kaboom");
	});
});
