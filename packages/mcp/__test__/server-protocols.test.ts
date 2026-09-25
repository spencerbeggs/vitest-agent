/**
 * The protocol surface of `ServerLayer`: the stateless `2026-07-28` adapter
 * (`server/discover`, per-request `_meta`, no handshake) beside the stateful
 * `2025-11-25` / `2025-06-18` ones (`McpStdio.protocols`), the
 * `instructions` every client receives, and a revision x outcome matrix
 * proving the `tools/call` result on each revision. Also pins that every
 * `Tool.make` tool is strict whatever its `Tool.Strict` annotation says
 * (`McpToolkit.layer`'s `strict: "all"` default).
 */

import { McpStdio, McpToolkit } from "@effected/mcp";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../src/server.js";
import type { JsonRpcMessage, McpHarness } from "./utils/harness.js";
import { STATELESS_PROTOCOL, makeHarness } from "./utils/harness.js";

class DeclaredFailure extends Schema.TaggedError<DeclaredFailure>()("DeclaredFailure", { message: Schema.String }) {}
const failingTool = Tool.make("fails", {
	description: "Throwaway tool with a declared failure.",
	success: Schema.Struct({ never: Schema.String }),
	failure: DeclaredFailure,
});
const strictTool = Tool.make("strict_fixture", {
	description: "Throwaway tool annotated Tool.Strict.",
	parameters: Schema.Struct({ name: Schema.String }),
	success: Schema.Struct({ echoed: Schema.String }),
}).annotate(Tool.Strict, true);
const lenientTool = Tool.make("lenient_fixture", {
	description: "Throwaway tool without the Tool.Strict annotation.",
	parameters: Schema.Struct({ name: Schema.String }),
	success: Schema.Struct({ echoed: Schema.String }),
});
const FixtureKit = Toolkit.make(failingTool, strictTool, lenientTool);
const FixtureLayer = McpToolkit.layer(FixtureKit).pipe(
	Layer.provide(
		FixtureKit.toLayer({
			fails: () => Effect.fail(new DeclaredFailure({ message: "declared boom" })),
			strict_fixture: ({ name }) => Effect.succeed({ echoed: name }),
			lenient_fixture: ({ name }) => Effect.succeed({ echoed: name }),
		}),
	),
);

const withHarness = <A>(
	f: (harness: McpHarness) => Effect.Effect<A>,
	options?: Parameters<typeof makeHarness>[0],
): Promise<A> => Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

interface DiscoverResult {
	supportedVersions: ReadonlyArray<string>;
	instructions?: string;
	_meta: Record<string, unknown>;
}

const jsonError = (message: JsonRpcMessage): { code: number; message: string } =>
	message.error as { code: number; message: string };

const EXPECTED_VERSIONS = [STATELESS_PROTOCOL, "2025-11-25", "2025-06-18"];

describe("server/discover on 2026-07-28 (stateless)", () => {
	it("advertises every listed adapter, stateless first, with the instructions and serverInfo", async () => {
		const response = await withHarness((h) => h.discover, { stateless: true, serverVersion: "9.9.9-test" });
		expect(response.error).toBeUndefined();
		const result = response.result as DiscoverResult;
		expect(result.supportedVersions).toEqual(EXPECTED_VERSIONS);
		expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
		expect(result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
			name: "vitest-agent",
			version: "9.9.9-test",
		});
	});

	it("tools/list answers with no handshake at all", async () => {
		const tools = await withHarness((h) => h.listTools, { stateless: true });
		const names = tools.map((t) => t.name);
		expect(names).toContain("ping");
		expect(names).toContain("help");
		const ping = tools.find((t) => t.name === "ping") as { inputSchema: Record<string, unknown> };
		expect(ping.inputSchema.additionalProperties).toBe(false);
	});

	it("initialize against the stateful adapters still works and carries the same instructions", async () => {
		const response = await withHarness((h) => h.initialize());
		const body = response.result as { protocolVersion: string; instructions?: string };
		expect(body.protocolVersion).toBe("2025-11-25");
		expect(body.instructions).toBe(SERVER_INSTRUCTIONS);
	});

	it("initialize on 2025-06-18 also carries the instructions", async () => {
		const response = await withHarness((h) => h.initialize(), { protocol: McpProtocol.v2025_06_18 });
		const body = response.result as { protocolVersion: string; instructions?: string };
		expect(body.protocolVersion).toBe("2025-06-18");
		expect(body.instructions).toBe(SERVER_INSTRUCTIONS);
	});
});

describe("tools/call revision x outcome matrix", () => {
	/** One harness per revision: stateless speaks `_meta`; the stateful ones initialize first. */
	const revisions: ReadonlyArray<{
		readonly version: string;
		readonly options: Parameters<typeof makeHarness>[0];
		readonly open: (h: McpHarness) => Effect.Effect<unknown>;
	}> = [
		{ version: STATELESS_PROTOCOL, options: { stateless: true, extraLayers: [FixtureLayer] }, open: (h) => h.discover },
		{ version: "2025-11-25", options: { extraLayers: [FixtureLayer] }, open: (h) => h.initialize() },
		{
			version: "2025-06-18",
			options: { protocol: McpProtocol.v2025_06_18, extraLayers: [FixtureLayer] },
			open: (h) => h.initialize(),
		},
	];

	for (const { version, options, open } of revisions) {
		describe(version, () => {
			it("success: structuredContent carries the typed result", async () => {
				const result = (await withHarness(
					(h) => open(h).pipe(Effect.andThen(h.callTool("ping", {}))),
					options,
				)) as CallToolResult;
				expect(result.isError).toBe(false);
				expect(result.structuredContent).toEqual({ message: "pong", distribution: null });
			});

			it("declared failure: isError with the message as text and no structuredContent", async () => {
				const result = (await withHarness(
					(h) => open(h).pipe(Effect.andThen(h.callTool("fails", {}))),
					options,
				)) as CallToolResult;
				expect(result.isError).toBe(true);
				expect(result.structuredContent).toBeUndefined();
				expect(result.content[0]?.text).toBe("declared boom");
			});

			it("invalid params: the unknown key is named on the revision's error surface", async () => {
				const response = await withHarness(
					(h) => open(h).pipe(Effect.andThen(h.sendRequest("tools/call", { name: "ping", arguments: { bogus: 1 } }))),
					options,
				);
				if (version === "2025-06-18") {
					// Pre-2025-11-25 revisions carry invalid params as a JSON-RPC -32602 error.
					expect(response.result).toBeUndefined();
					expect(jsonError(response).code).toBe(-32602);
					expect(jsonError(response).message).toContain("Unrecognized parameter(s): bogus");
				} else {
					const result = response.result as CallToolResult;
					expect(result.isError).toBe(true);
					expect(result.structuredContent).toBeUndefined();
					expect(result.content[0]?.text).toContain("Unrecognized parameter(s): bogus");
				}
			});
		});
	}

	it("a 2026-07-28 tools/call result is wrapped in the stateless frame", async () => {
		const response = await withHarness(
			(h) => h.discover.pipe(Effect.andThen(h.sendRequest("tools/call", { name: "ping", arguments: {} }))),
			{ stateless: true },
		);
		const result = response.result as CallToolResult & { _meta: Record<string, unknown>; resultType?: string };
		expect(result.resultType).toBe("complete");
		expect(result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "vitest-agent" });
		expect(result.structuredContent?.message).toBe("pong");
	});
});

describe("McpStdio.protocols", () => {
	it("serves the stateless revision first, then the two newest stateful ones", () => {
		expect(McpStdio.protocols.map((adapter) => adapter.protocolVersion)).toEqual(EXPECTED_VERSIONS);
	});
});

describe("every tool is strict, with or without Tool.Strict", () => {
	it("a strict tool and a lenient sibling both reject an excess property and serve additionalProperties: false", async () => {
		const { tools, strictResult, lenientResult, strictOk, lenientOk } = await withHarness(
			(h) =>
				Effect.gen(function* () {
					yield* h.initialize();
					const tools = yield* h.listTools;
					const strictResult = (yield* h.callTool("strict_fixture", { name: "a", extra: 1 })) as CallToolResult;
					const lenientResult = (yield* h.callTool("lenient_fixture", { name: "a", extra: 1 })) as CallToolResult;
					const strictOk = (yield* h.callTool("strict_fixture", { name: "a" })) as CallToolResult;
					const lenientOk = (yield* h.callTool("lenient_fixture", { name: "a" })) as CallToolResult;
					return { tools, strictResult, lenientResult, strictOk, lenientOk };
				}),
			{ extraLayers: [FixtureLayer] },
		);
		for (const name of ["strict_fixture", "lenient_fixture"]) {
			const tool = tools.find((t) => t.name === name) as { inputSchema: Record<string, unknown> };
			expect(tool.inputSchema.type, name).toBe("object");
			expect(tool.inputSchema.additionalProperties, name).toBe(false);
		}
		for (const result of [strictResult, lenientResult]) {
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Unrecognized parameter(s): extra");
			expect(result.content[0]?.text).toContain("Accepted params: name");
		}
		expect(strictOk.structuredContent).toEqual({ echoed: "a" });
		expect(lenientOk.structuredContent).toEqual({ echoed: "a" });
	});
});
