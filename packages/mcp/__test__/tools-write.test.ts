/**
 * The write tools (and the two TDD lookups) over the in-process stdio
 * harness: each is listed with the write-side annotation set, and a
 * representative `tools/call` returns the typed `structuredContent` plus
 * the text channel. The idempotently-wrapped tools are called twice and
 * the replay marker asserted on the second response. Assertions mirror
 * the tRPC-caller tests in `router.test.ts` and the old InMemoryTransport
 * schema suites (`server-hypothesis-schema`, `server-tdd-artifact-list-
 * schema`, `server-run-tests-*-schema`, `server-tool-resolver-throw`)
 * they replace.
 */

import { DataStore } from "@vitest-agent/engine";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HarnessOptions, McpHarness, McpToolDescriptor } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

interface CallToolResult {
	isError?: boolean;
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
}

const withHarness = <A>(f: (harness: McpHarness) => Effect.Effect<A>, options?: HarnessOptions): Promise<A> =>
	Effect.runPromise(Effect.scoped(Effect.flatMap(makeHarness(options), f)));

/** Runs `initialize`, then `steps` in order; resolves to every step's result. */
const session = (steps: (h: McpHarness) => Effect.Effect<ReadonlyArray<unknown>>, options?: HarnessOptions) =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(steps(h))), options) as Promise<ReadonlyArray<CallToolResult>>;

const call = (name: string, args: unknown, options?: HarnessOptions): Promise<CallToolResult> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.callTool(name, args))), options) as Promise<CallToolResult>;

const listTools = (): Promise<ReadonlyArray<McpToolDescriptor>> =>
	withHarness((h) => h.initialize().pipe(Effect.andThen(h.listTools)));

const text = (result: CallToolResult): string => result.content[0]?.text ?? "";

/** Seed a host session row (the FK every write tool resolves through) against the harness store. */
const seedSession = (h: McpHarness, chatId: string, agentKind: "main" | "subagent" = "main") =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		return yield* store.writeSession({
			chatId,
			project: "default",
			cwd: process.cwd(),
			agentKind,
			...(agentKind === "subagent" && { agentType: "tdd-task" }),
			startedAt: new Date().toISOString(),
		});
	}).pipe(Effect.provideContext(h.services), Effect.orDie);

const seedTddTask = (h: McpHarness, chatId: string) =>
	Effect.gen(function* () {
		const sessionId = yield* seedSession(h, chatId, "subagent");
		const store = yield* DataStore;
		const tddTaskId = yield* store.writeTddTask({ sessionId, goal: "obj", startedAt: new Date().toISOString() });
		return { sessionId, tddTaskId };
	}).pipe(Effect.provideContext(h.services), Effect.orDie);

const WRITE_TOOLS = ["register_agent", "note", "hypothesis"] as const;
const DESTRUCTIVE_TOOLS = ["note"] as const;
const IDEMPOTENT_TOOLS = ["register_agent"] as const;

describe("write tools: tools/list", () => {
	it("lists every write tool with readOnly false and openWorld false, and the per-tool destructive/idempotent hints", async () => {
		const tools = await listTools();
		for (const name of WRITE_TOOLS) {
			const tool = tools.find((t) => t.name === name);
			expect(tool, name).toBeDefined();
			expect(tool?.annotations, `${name} annotations`).toMatchObject({
				readOnlyHint: false,
				openWorldHint: false,
				destructiveHint: (DESTRUCTIVE_TOOLS as ReadonlyArray<string>).includes(name),
				idempotentHint: (IDEMPOTENT_TOOLS as ReadonlyArray<string>).includes(name),
			});
			expect(typeof tool?.title).toBe("string");
			expect(tool?.description?.length ?? 0).toBeGreaterThan(20);
		}
	});
});

describe("register_agent", () => {
	it("rejects an agentType that does not start with the host-kind prefix", async () => {
		const result = await call("register_agent", {
			chatId: "any-session",
			agentType: "cursor-main",
			hostKind: "claude-code",
		});
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "INVALID_AGENT_TYPE_PREFIX", expectedPrefix: "claude-code-" },
		});
		expect(JSON.parse(text(result))).toEqual(result.structuredContent);
	});

	it("returns SESSION_NOT_FOUND when the host has not registered the session yet", async () => {
		const result = await call("register_agent", { chatId: "never-seen-session", agentType: "claude-code-main" });
		expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "SESSION_NOT_FOUND" } });
	});

	it("registers a fresh agent, then reports AGENT_ALREADY_REGISTERED with the existing id on the same triple", async () => {
		const [first, second] = await session((h) =>
			Effect.gen(function* () {
				yield* seedSession(h, "session-idem-1");
				const a = yield* h.callTool("register_agent", { chatId: "session-idem-1", agentType: "claude-code-main" });
				const b = yield* h.callTool("register_agent", { chatId: "session-idem-1", agentType: "claude-code-main" });
				return [a, b];
			}),
		);
		expect(first?.structuredContent?.ok).toBe(true);
		expect(first?.structuredContent?.agentId).toMatch(/^[0-9a-f-]{36}$/);
		expect(second?.structuredContent).toMatchObject({
			ok: false,
			error: { code: "AGENT_ALREADY_REGISTERED", existingAgentId: first?.structuredContent?.agentId },
		});
	});

	it("two distinct clientNonces produce two distinct agents under the same parent", async () => {
		const [main, subA, subB] = await session((h) =>
			Effect.gen(function* () {
				yield* seedSession(h, "session-sib-1");
				const main = (yield* h.callTool("register_agent", {
					chatId: "session-sib-1",
					agentType: "claude-code-main",
				})) as CallToolResult;
				const parentAgentId = main.structuredContent?.agentId;
				const a = yield* h.callTool("register_agent", {
					chatId: "session-sib-1",
					agentType: "claude-code-tdd-task",
					parentAgentId,
					clientNonce: "sib-A",
				});
				const b = yield* h.callTool("register_agent", {
					chatId: "session-sib-1",
					agentType: "claude-code-tdd-task",
					parentAgentId,
					clientNonce: "sib-B",
				});
				return [main, a, b];
			}),
		);
		expect(main?.structuredContent?.ok).toBe(true);
		expect(subA?.structuredContent?.ok).toBe(true);
		expect(subB?.structuredContent?.ok).toBe(true);
		expect(subA?.structuredContent?.agentId).not.toBe(subB?.structuredContent?.agentId);
	});

	it("rejects an unknown parameter naming the accepted params", async () => {
		const result = await call("register_agent", { chatId: "x", agentType: "claude-code-main", sessionId: "nope" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("sessionId");
		expect(text(result)).toContain("Accepted params");
	});
});

describe("note", () => {
	it("serves a oneOf discriminated on action", async () => {
		const tool = (await listTools()).find((t) => t.name === "note");
		expect(tool?.inputSchema["x-discriminator"]).toBe("action");
		expect(Array.isArray(tool?.inputSchema.oneOf)).toBe(true);
	});

	it("runs the CRUD lifecycle: create, get, update, get, delete, get", async () => {
		const results = await session((h) =>
			Effect.gen(function* () {
				const created = (yield* h.callTool("note", {
					action: "create",
					title: "Test Note",
					content: "Content",
					scope: "global",
				})) as CallToolResult;
				const id = created.structuredContent?.id;
				const got = yield* h.callTool("note", { action: "get", id });
				const updated = yield* h.callTool("note", { action: "update", id, title: "Updated" });
				const gotAgain = yield* h.callTool("note", { action: "get", id });
				const deleted = yield* h.callTool("note", { action: "delete", id });
				const gone = yield* h.callTool("note", { action: "get", id });
				return [created, got, updated, gotAgain, deleted, gone];
			}),
		);
		const [created, got, updated, gotAgain, deleted, gone] = results;
		expect(created?.structuredContent?.action).toBe("create");
		expect(typeof created?.structuredContent?.id).toBe("number");
		// Mutations render the pretty-printed JSON as the text channel.
		expect(JSON.parse(text(created as CallToolResult))).toEqual(created?.structuredContent);
		expect(got?.structuredContent).toMatchObject({ action: "get", found: true, note: { title: "Test Note" } });
		expect(updated?.structuredContent).toEqual({ action: "update", success: true });
		expect(gotAgain?.structuredContent).toMatchObject({ found: true, note: { title: "Updated" } });
		expect(deleted?.structuredContent).toEqual({ action: "delete", success: true });
		expect(gone?.structuredContent).toMatchObject({ action: "get", found: false });
	});

	it("list returns the cold-start text and count 0 when nothing matches", async () => {
		const result = await call("note", { action: "list", scope: "test", testFullName: "nonexistent" });
		expect(result.structuredContent).toEqual({ action: "list", count: 0, notes: [] });
		expect(text(result)).toBe('No notes found. Use note({ action: "create", ... }) to add notes.');
	});

	it("list and search render the markdown table over the created notes", async () => {
		const [listed, searched, missed] = await session((h) =>
			Effect.gen(function* () {
				yield* h.callTool("note", {
					action: "create",
					title: "Table Note",
					content: "xylophone content",
					scope: "global",
				});
				const listed = yield* h.callTool("note", { action: "list" });
				const searched = yield* h.callTool("note", { action: "search", query: "xylophone" });
				const missed = yield* h.callTool("note", { action: "search", query: "nonexistentkeyword999" });
				return [listed, searched, missed];
			}),
		);
		expect(listed?.structuredContent?.count).toBe(1);
		expect(text(listed as CallToolResult)).toContain("## Notes");
		expect(text(listed as CallToolResult)).toContain("| Table Note |");
		expect(searched?.structuredContent).toMatchObject({ action: "search", query: "xylophone", count: 1 });
		expect(text(searched as CallToolResult)).toContain('## Notes matching "xylophone"');
		expect(missed?.structuredContent).toMatchObject({ action: "search", count: 0 });
		expect(text(missed as CallToolResult)).toBe("No notes matched.");
	});

	it("rejects an unknown action, a missing required key, and a key that belongs to another variant", async () => {
		const unknownAction = await call("note", { action: "purge" });
		expect(unknownAction.isError).toBe(true);
		const missing = await call("note", { action: "create", title: "no content" });
		expect(missing.isError).toBe(true);
		const foreign = await call("note", { action: "get", id: 1, query: "x" });
		expect(foreign.isError).toBe(true);
		expect(text(foreign)).toContain("query");
		expect(text(foreign)).toContain("Accepted params");
	});
});

describe("hypothesis", () => {
	it("declares tddTaskId (number or numeric string) on the record variant and validatedAt as optional on validate", async () => {
		const tool = (await listTools()).find((t) => t.name === "hypothesis") as McpToolDescriptor;
		expect(tool.inputSchema["x-discriminator"]).toBe("action");
		const members = tool.inputSchema.oneOf as ReadonlyArray<Record<string, unknown>>;
		const byAction = (action: string) =>
			members.find((m) => {
				const property = (m.properties as Record<string, { const?: string; enum?: ReadonlyArray<string> }>).action;
				return property?.const === action || property?.enum?.[0] === action;
			}) as Record<string, unknown>;
		const record = byAction("record");
		const recordProps = record.properties as Record<string, Record<string, unknown>>;
		expect(Object.keys(recordProps)).toContain("tddTaskId");
		expect(recordProps.tddTaskId?.anyOf).toEqual([{ type: "number" }, { type: "string" }]);
		const validate = byAction("validate");
		expect(Object.keys(validate.properties as object)).toContain("validatedAt");
		expect((validate.required as ReadonlyArray<string>) ?? []).not.toContain("validatedAt");
		// The description must not present record as sessionId-first nor validate as validatedAt-required.
		expect(tool.description).not.toContain("action='record' (sessionId");
		expect(tool.description).toContain("tddTaskId");
		expect(tool.description).not.toContain("action='validate' (id, outcome, validatedAt)");
		expect(tool.description).toContain("validatedAt?");
	});

	it("record forwards a numeric-string tddTaskId end-to-end and binds to the task's session", async () => {
		const [recorded, listed] = await session((h) =>
			Effect.gen(function* () {
				const { sessionId, tddTaskId } = yield* seedTddTask(h, "cc-hyp-tddtask-str");
				const recorded = yield* h.callTool("hypothesis", {
					action: "record",
					tddTaskId: String(tddTaskId),
					content: "stringified tddTaskId must bind the same as the numeric form.",
				});
				const listed = yield* h.callTool("hypothesis", { action: "list", sessionId });
				return [recorded, listed];
			}),
		);
		expect(recorded?.isError ?? false).toBe(false);
		expect(recorded?.structuredContent?.action).toBe("record");
		expect(recorded?.structuredContent?.id).toBeGreaterThan(0);
		expect(listed?.structuredContent?.count).toBe(1);
		expect(text(listed as CallToolResult)).toContain("# Hypotheses");
	});

	it("record binds to the main session's active subagent child from the recovered context", async () => {
		// Served through the harness's default `McpSession.layerTest()` — no
		// recovered context — so the route under test is the caller-supplied
		// sessionId fallback; the context-driven resolution is pinned by the
		// `makeCaller` tests in router.test.ts.
		const [recorded, listed] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-hyp-fallback");
				const recorded = yield* h.callTool("hypothesis", { action: "record", sessionId, content: "fallback binding" });
				const listed = yield* h.callTool("hypothesis", { action: "list", sessionId });
				return [recorded, listed];
			}),
		);
		expect(recorded?.structuredContent?.action).toBe("record");
		expect(listed?.structuredContent?.count).toBe(1);
	});

	it("record with an unknown tddTaskId returns the UnexpectedToolError envelope as an error result", async () => {
		const result = await call("hypothesis", { action: "record", tddTaskId: 987654, content: "never written" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { _tag: "UnexpectedToolError", tool: "hypothesis" },
		});
		expect(String((result.structuredContent?.error as { message: string } | undefined)?.message)).toContain(
			"unknown tddTaskId 987654",
		);
	});

	it("record rejects a non-numeric string tddTaskId", async () => {
		const result = await call("hypothesis", { action: "record", tddTaskId: "abc", content: "never written" });
		expect(result.isError).toBe(true);
	});

	it("validate defaults validatedAt server-side, and a second identical validate replays from the idempotency cache", async () => {
		const before = Date.now();
		const [first, second, listed] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-hyp-validate");
				const id = yield* Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeHypothesis({ sessionId, content: "Race condition in the event loop." });
				}).pipe(Effect.provideContext(h.services), Effect.orDie);
				const first = yield* h.callTool("hypothesis", { action: "validate", id, outcome: "confirmed" });
				const second = yield* h.callTool("hypothesis", { action: "validate", id, outcome: "confirmed" });
				const listed = yield* h.callTool("hypothesis", { action: "list", sessionId });
				return [first, second, listed];
			}),
		);
		expect(first?.structuredContent).toEqual({ action: "validate" });
		expect(second?.structuredContent).toEqual({ action: "validate", _idempotentReplay: true });
		const row = (listed?.structuredContent?.hypotheses as Array<{ validatedAt: string | null }> | undefined)?.[0];
		expect(row?.validatedAt).not.toBeNull();
		expect(new Date(row?.validatedAt as string).getTime()).toBeGreaterThanOrEqual(before);
	});

	it("validate with an explicit validatedAt persists that exact string", async () => {
		const [listed] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-hyp-validate-explicit");
				const id = yield* Effect.gen(function* () {
					const store = yield* DataStore;
					return yield* store.writeHypothesis({ sessionId, content: "Explicit validatedAt must win." });
				}).pipe(Effect.provideContext(h.services), Effect.orDie);
				yield* h.callTool("hypothesis", {
					action: "validate",
					id,
					outcome: "refuted",
					validatedAt: "2020-01-01T00:00:00.000Z",
				});
				return [yield* h.callTool("hypothesis", { action: "list", sessionId })];
			}),
		);
		const row = (listed?.structuredContent?.hypotheses as Array<{ validatedAt: string | null }> | undefined)?.[0];
		expect(row?.validatedAt).toBe("2020-01-01T00:00:00.000Z");
	});

	it("list returns 'No hypotheses matched.' on an empty DB", async () => {
		const result = await call("hypothesis", { action: "list" });
		expect(result.structuredContent).toEqual({ action: "list", count: 0, hypotheses: [] });
		expect(text(result)).toBe("No hypotheses matched.");
	});
});
