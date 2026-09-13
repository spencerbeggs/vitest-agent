/**
 * The write tools (and the two TDD lookups) over the in-process stdio
 * harness: each is listed with the write-side annotation set, and a
 * representative `tools/call` returns the typed `structuredContent` plus
 * the text channel. The idempotently-wrapped tools are called twice and
 * the replay marker asserted on the second response. Assertions mirror
 * the direct-caller tests in `tool-handlers.test.ts` and the retired InMemoryTransport
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

/** A typed view of one `structuredContent` field (an absent result reads as `{}`). */
const field = <T>(result: CallToolResult | undefined, key: string): T =>
	((result?.structuredContent ?? {}) as Record<string, unknown>)[key] as T;

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

const WRITE_TOOLS = [
	"register_agent",
	"note",
	"hypothesis",
	"tdd_task",
	"tdd_phase_transition_request",
	"tdd_goal",
	"tdd_behavior",
	"tdd_progress_push",
] as const;
const DESTRUCTIVE_TOOLS = ["note", "tdd_goal", "tdd_behavior"] as const;
const IDEMPOTENT_TOOLS = ["register_agent", "tdd_task", "tdd_phase_transition_request"] as const;

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

	it("lists tdd_artifact_list with the read-only annotation set", async () => {
		const tool = (await listTools()).find((t) => t.name === "tdd_artifact_list");
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
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
		// `makeCaller` tests in tool-handlers.test.ts.
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

describe("tdd_task", () => {
	it("start inserts on the first call and replays with _idempotentReplay on the second", async () => {
		const [r1, r2] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-tdd-start-test");
				const r1 = yield* h.callTool("tdd_task", { action: "start", sessionId, goal: "add login" });
				const r2 = yield* h.callTool("tdd_task", { action: "start", sessionId, goal: "add login" });
				return [r1, r2];
			}),
		);
		expect(r1?.structuredContent).toMatchObject({ action: "start", goal: "add login" });
		expect(r1?.structuredContent?._idempotentReplay).toBeUndefined();
		expect(r2?.structuredContent).toMatchObject({
			action: "start",
			tddTaskId: r1?.structuredContent?.tddTaskId,
			_idempotentReplay: true,
		});
		// start/end render the JSON as the text channel.
		expect(JSON.parse(text(r2 as CallToolResult))).toEqual(r2?.structuredContent);
	});

	it("end closes the task and replays on a duplicate; get and resume then report the outcome", async () => {
		const [r1, r2, got, resumed] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-tdd-end-test");
				const created = (yield* h.callTool("tdd_task", {
					action: "start",
					sessionId,
					goal: "ending-test",
				})) as CallToolResult;
				const tddTaskId = created.structuredContent?.tddTaskId;
				const r1 = yield* h.callTool("tdd_task", { action: "end", tddTaskId, outcome: "succeeded" });
				const r2 = yield* h.callTool("tdd_task", { action: "end", tddTaskId, outcome: "succeeded" });
				const got = yield* h.callTool("tdd_task", { action: "get", tddTaskId });
				const resumed = yield* h.callTool("tdd_task", { action: "resume", tddTaskId });
				return [r1, r2, got, resumed];
			}),
		);
		expect(r1?.structuredContent).toEqual({ action: "end", tddTaskId: expect.any(Number), outcome: "succeeded" });
		expect(r2?.structuredContent?._idempotentReplay).toBe(true);
		expect(got?.structuredContent).toMatchObject({ action: "get", found: true, task: { goal: "ending-test" } });
		expect(text(got as CallToolResult)).toContain("- current phase: spike [phaseId=");
		expect(resumed?.structuredContent).toMatchObject({ action: "resume", found: true, status: "succeeded" });
		expect(text(resumed as CallToolResult)).toContain("**Status:** succeeded");
	});

	it("get and resume return found=false for an unknown id", async () => {
		const got = await call("tdd_task", { action: "get", tddTaskId: 99999 });
		expect(got.structuredContent).toEqual({ action: "get", found: false, tddTaskId: 99999 });
		expect(text(got)).toBe("No TDD task with tddTaskId=99999.");
		const resumed = await call("tdd_task", { action: "resume", tddTaskId: 99999 });
		expect(resumed.structuredContent).toEqual({ action: "resume", found: false, tddTaskId: 99999 });
	});

	it("start with an unknown chatId returns the UnexpectedToolError envelope", async () => {
		const result = await call("tdd_task", { action: "start", chatId: "never-seen", goal: "x" });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { _tag: "UnexpectedToolError", tool: "tdd_task" },
		});
		expect(String((result.structuredContent?.error as { message: string } | undefined)?.message)).toContain(
			"Unknown chatId",
		);
	});

	it("rejects an unknown action and a foreign key", async () => {
		expect((await call("tdd_task", { action: "pause", tddTaskId: 1 })).isError).toBe(true);
		const foreign = await call("tdd_task", { action: "get", tddTaskId: 1, goal: "x" });
		expect(foreign.isError).toBe(true);
		expect(text(foreign)).toContain("Accepted params");
	});
});

/** Open a task, create a goal, move it to in_progress; returns the ids. */
const seedTaskWithGoal = (h: McpHarness, chatId: string) =>
	Effect.gen(function* () {
		const sessionId = yield* seedSession(h, chatId);
		const task = (yield* h.callTool("tdd_task", { action: "start", sessionId, goal: "goal text" })) as CallToolResult;
		const tddTaskId = task.structuredContent?.tddTaskId as number;
		const goal = (yield* h.callTool("tdd_goal", { action: "create", tddTaskId, goal: "goal text" })) as CallToolResult;
		const goalId = field<{ id: number }>(goal, "goal").id;
		yield* h.callTool("tdd_goal", { action: "update", id: goalId, status: "in_progress" });
		return { sessionId, tddTaskId, goalId };
	});

describe("tdd_task get over a populated tree", () => {
	it("encodes the nested goals/behaviors, phases, artifacts and currentPhase through the wire", async () => {
		const [got] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId, goalId } = yield* seedTaskWithGoal(h, "cc-tdd-get-populated");
				const behavior = (yield* h.callTool("tdd_behavior", {
					action: "create",
					goalId,
					behavior: "returns the sum",
					suggestedTestName: "adds numbers",
				})) as CallToolResult;
				const behaviorId = field<{ id: number }>(behavior, "behavior").id;
				const entered = (yield* h.callTool("tdd_phase_transition_request", {
					tddTaskId,
					goalId,
					requestedPhase: "red",
					behaviorId,
					reason: "start the cycle",
				})) as CallToolResult;
				const phaseId = entered.structuredContent?.newPhaseId as number;
				yield* Effect.gen(function* () {
					const store = yield* DataStore;
					yield* store.writeTddArtifact({ phaseId, artifactKind: "test_written", recordedAt: "2026-09-05T00:00:03Z" });
				}).pipe(Effect.provideContext(h.services), Effect.orDie);
				return [yield* h.callTool("tdd_task", { action: "get", tddTaskId })];
			}),
		);
		expect(got?.isError).toBe(false);
		expect(got?.structuredContent).toMatchObject({
			action: "get",
			found: true,
			task: {
				goal: "goal text",
				endedAt: null,
				outcome: null,
				goals: [
					{
						goal: "goal text",
						status: "in_progress",
						behaviors: [{ behavior: "returns the sum", suggestedTestName: "adds numbers", status: "in_progress" }],
					},
				],
				phases: [
					{ phase: "spike" },
					{ phase: "red", behaviorId: expect.any(Number), transitionReason: "start the cycle" },
				],
				artifacts: [{ artifactKind: "test_written", testCaseId: null, testRunId: null }],
			},
			currentPhase: { phase: "red", behaviorId: expect.any(Number) },
		});
		const markdown = text(got as CallToolResult);
		expect(markdown).toContain("## Goals and Behaviors");
		expect(markdown).toContain("- **returns the sum** [in_progress]");
		expect(markdown).toContain("## Artifacts");
	});
});

describe("tdd_goal", () => {
	it("create returns the goal with ordinal 0 and replays with the marker on a duplicate", async () => {
		const [a, b] = await session((h) =>
			Effect.gen(function* () {
				const sessionId = yield* seedSession(h, "cc-mcp-goal-idem");
				const task = (yield* h.callTool("tdd_task", { action: "start", sessionId, goal: "obj" })) as CallToolResult;
				const tddTaskId = task.structuredContent?.tddTaskId;
				const a = yield* h.callTool("tdd_goal", { action: "create", tddTaskId, goal: "Handle bounds" });
				const b = yield* h.callTool("tdd_goal", { action: "create", tddTaskId, goal: "Handle bounds" });
				return [a, b];
			}),
		);
		expect(a?.structuredContent).toMatchObject({
			ok: true,
			action: "create",
			goal: { ordinal: 0, goal: "Handle bounds", status: "pending" },
		});
		expect(b?.structuredContent).toMatchObject({
			ok: true,
			goal: { id: field<{ id: number }>(a, "goal").id },
			_idempotentReplay: true,
		});
	});

	it("create against an unknown task returns the TddTaskNotFoundError envelope with an object remediation", async () => {
		const result = await call("tdd_goal", { action: "create", tddTaskId: 99999, goal: "G" });
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: {
				_tag: "TddTaskNotFoundError",
				id: 99999,
				remediation: { suggestedTool: "tdd_task", suggestedArgs: { action: "start" } },
			},
		});
		expect(field<{ remediation: { humanHint: string } }>(result, "error").remediation.humanHint).toContain("tdd_task");
	});

	it("supports the get, update, list lifecycle and the IllegalStatusTransitionError envelope", async () => {
		const [fetched, updated, list, illegal] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId, goalId } = yield* seedTaskWithGoal(h, "cc-mcp-goal-lifecycle");
				const fetched = yield* h.callTool("tdd_goal", { action: "get", id: goalId });
				const updated = yield* h.callTool("tdd_goal", { action: "update", id: goalId, status: "done" });
				const list = yield* h.callTool("tdd_goal", { action: "list", tddTaskId });
				const illegal = yield* h.callTool("tdd_goal", { action: "update", id: goalId, status: "pending" });
				return [fetched, updated, list, illegal];
			}),
		);
		expect(fetched?.structuredContent).toMatchObject({
			action: "get",
			found: true,
			goal: { goal: "goal text", behaviors: [] },
		});
		expect(updated?.structuredContent).toMatchObject({ ok: true, action: "update", goal: { status: "done" } });
		expect(field<ReadonlyArray<{ status: string }>>(list, "goals").map((g) => g.status)).toEqual(["done"]);
		expect(illegal?.structuredContent).toMatchObject({ ok: false, error: { _tag: "IllegalStatusTransitionError" } });
	});

	it("delete removes the goal", async () => {
		const [deleted, gone] = await session((h) =>
			Effect.gen(function* () {
				const { goalId } = yield* seedTaskWithGoal(h, "cc-mcp-goal-delete");
				const deleted = yield* h.callTool("tdd_goal", { action: "delete", id: goalId });
				const gone = yield* h.callTool("tdd_goal", { action: "get", id: goalId });
				return [deleted, gone];
			}),
		);
		expect(deleted?.structuredContent).toMatchObject({ ok: true, action: "delete" });
		expect(gone?.structuredContent).toMatchObject({ action: "get", found: false });
	});
});

describe("tdd_behavior", () => {
	it("create replays with the marker; get surfaces parentGoal and dependencies; delete cascades", async () => {
		const [dep, depAgain, fetched, byGoal, byTask, deleted, gone] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId, goalId } = yield* seedTaskWithGoal(h, "cc-mcp-beh-deps");
				const dep = (yield* h.callTool("tdd_behavior", {
					action: "create",
					goalId,
					behavior: "dep",
				})) as CallToolResult;
				const depAgain = yield* h.callTool("tdd_behavior", { action: "create", goalId, behavior: "dep" });
				const depId = field<{ id: number }>(dep, "behavior").id;
				const target = (yield* h.callTool("tdd_behavior", {
					action: "create",
					goalId,
					behavior: "target",
					dependsOnBehaviorIds: [depId],
				})) as CallToolResult;
				const targetId = field<{ id: number }>(target, "behavior").id;
				const fetched = yield* h.callTool("tdd_behavior", { action: "get", id: targetId });
				const byGoal = yield* h.callTool("tdd_behavior", { action: "list_by_goal", goalId });
				const byTask = yield* h.callTool("tdd_behavior", { action: "list_by_tdd_task", tddTaskId });
				const deleted = yield* h.callTool("tdd_behavior", { action: "delete", id: targetId });
				const gone = yield* h.callTool("tdd_behavior", { action: "get", id: targetId });
				return [dep, depAgain, fetched, byGoal, byTask, deleted, gone];
			}),
		);
		expect(dep?.structuredContent).toMatchObject({ ok: true, action: "create", behavior: { behavior: "dep" } });
		expect(depAgain?.structuredContent).toMatchObject({ ok: true, _idempotentReplay: true });
		expect(fetched?.structuredContent).toMatchObject({
			action: "get",
			found: true,
			behavior: { behavior: "target", parentGoal: { goal: "goal text" }, dependencies: [{ behavior: "dep" }] },
		});
		expect(field<ReadonlyArray<{ behavior: string }>>(byGoal, "behaviors").map((b) => b.behavior)).toEqual([
			"dep",
			"target",
		]);
		expect(byTask?.structuredContent).toMatchObject({ ok: true, action: "list_by_tdd_task" });
		expect(deleted?.structuredContent).toMatchObject({ ok: true, action: "delete" });
		expect(gone?.structuredContent).toMatchObject({ action: "get", found: false });
	});

	it("create against an unknown goal returns the GoalNotFoundError envelope", async () => {
		const result = await call("tdd_behavior", { action: "create", goalId: 99999, behavior: "x" });
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { _tag: "GoalNotFoundError", remediation: { suggestedTool: "tdd_goal" } },
		});
	});
});

describe("tdd_phase_transition_request", () => {
	it("denies with goal_not_found, and with missing_artifact_evidence when the cited artifact does not exist", async () => {
		const [notFound, missing] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId, goalId } = yield* seedTaskWithGoal(h, "cc-mcp-ptr");
				const notFound = yield* h.callTool("tdd_phase_transition_request", {
					tddTaskId,
					goalId: 99999,
					requestedPhase: "red",
				});
				const missing = yield* h.callTool("tdd_phase_transition_request", {
					tddTaskId,
					goalId,
					requestedPhase: "green",
					citedArtifactId: 999999,
				});
				return [notFound, missing];
			}),
		);
		expect(notFound?.structuredContent).toMatchObject({ accepted: false, denialReason: "goal_not_found" });
		expect(missing?.structuredContent).toMatchObject({
			accepted: false,
			denialReason: "missing_artifact_evidence",
			remediation: { suggestedTool: "run_tests" },
		});
		expect(JSON.parse(text(missing as CallToolResult))).toEqual(missing?.structuredContent);
	});

	it("accepts spike -> red with no artifact and echoes the new phase id", async () => {
		const [accepted] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId, goalId } = yield* seedTaskWithGoal(h, "cc-mcp-ptr-accept");
				return [yield* h.callTool("tdd_phase_transition_request", { tddTaskId, goalId, requestedPhase: "red" })];
			}),
		);
		expect(accepted?.structuredContent).toMatchObject({ accepted: true, phase: "red", newPhaseId: expect.any(Number) });
		expect(accepted?.structuredContent?.citedArtifactId).toBeUndefined();
	});

	it("rejects a missing goalId and an unknown key", async () => {
		expect((await call("tdd_phase_transition_request", { tddTaskId: 1, requestedPhase: "red" })).isError).toBe(true);
		const unknown = await call("tdd_phase_transition_request", {
			tddTaskId: 1,
			goalId: 1,
			requestedPhase: "red",
			phase: "x",
		});
		expect(unknown.isError).toBe(true);
		expect(text(unknown)).toContain("Accepted params");
	});
});

describe("tdd_artifact_list", () => {
	it('lists the recorded artifacts newest-first, echoes suite:"bats" for a bats-suite artifact, and honors artifactKind', async () => {
		const [all, filtered, none] = await session((h) =>
			Effect.gen(function* () {
				const { tddTaskId } = yield* seedTddTask(h, "cc-served-schema-artifact-suite");
				yield* Effect.gen(function* () {
					const store = yield* DataStore;
					const red = yield* store.writeTddPhase({ tddTaskId, phase: "red", startedAt: "2026-09-05T00:00:02Z" });
					yield* store.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "test_written",
						recordedAt: "2026-09-05T00:00:03Z",
					});
					yield* store.writeTddArtifact({
						phaseId: red.id,
						artifactKind: "test_failed_run",
						recordedAt: "2026-09-05T00:00:04Z",
						suite: "bats",
					});
				}).pipe(Effect.provideContext(h.services), Effect.orDie);
				const all = yield* h.callTool("tdd_artifact_list", { tddTaskId });
				const filtered = yield* h.callTool("tdd_artifact_list", { tddTaskId, artifactKind: "test_failed_run" });
				const none = yield* h.callTool("tdd_artifact_list", { tddTaskId, artifactKind: "refactor" });
				return [all, filtered, none];
			}),
		);
		expect(all?.isError ?? false).toBe(false);
		expect(all?.structuredContent?.count).toBe(2);
		const artifacts = all?.structuredContent?.artifacts as ReadonlyArray<{ artifactKind: string; suite: string }>;
		expect(artifacts.map((a) => a.artifactKind)).toEqual(["test_failed_run", "test_written"]);
		expect(artifacts[0]?.suite).toBe("bats");
		expect(text(all as CallToolResult)).toContain("(newest first, 2 shown)");
		expect(filtered?.structuredContent).toMatchObject({ count: 1, filters: { artifactKind: "test_failed_run" } });
		expect(none?.structuredContent).toMatchObject({ count: 0, artifacts: [] });
		expect(text(none as CallToolResult)).toContain("No artifacts recorded");
	});

	it("advertises an object outputSchema and rejects an unknown filter", async () => {
		const tool = (await listTools()).find((t) => t.name === "tdd_artifact_list");
		expect(tool?.outputSchema?.type).toBe("object");
		const result = await call("tdd_artifact_list", { tddTaskId: 1, kind: "test_written" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("kind");
	});
});

describe("tdd_progress_push", () => {
	it("returns { ok: true } and publishes a notifications/message frame carrying the enriched event", async () => {
		const [result, frames] = await withHarness((h) =>
			h.initialize().pipe(
				Effect.andThen(
					Effect.gen(function* () {
						// A filler session first so the host session id and the tdd task id diverge.
						yield* seedSession(h, "cc-progress-push-filler");
						const { tddTaskId } = yield* seedTddTask(h, "cc-progress-push");
						const goal = (yield* h.callTool("tdd_goal", { action: "create", tddTaskId, goal: "G" })) as CallToolResult;
						const goalId = field<{ id: number }>(goal, "goal").id;
						const result = yield* h.callTool("tdd_progress_push", {
							// A stale sessionId (0) — the server must overwrite it from the goal row.
							payload: JSON.stringify({ type: "goal_started", sessionId: 0, goalId }),
						});
						// The notification is broadcast asynchronously; give the wire a turn.
						yield* Effect.sleep("50 millis");
						const frames = (yield* h.rawStdoutSoFar).join("");
						return [result as CallToolResult, { frames, tddTaskId, goalId }] as const;
					}),
				),
			),
		);
		expect(result.structuredContent).toEqual({ ok: true });
		expect(frames.frames).toContain('"method":"notifications/message"');
		expect(frames.frames).toContain('"logger":"vitest-agent/channel"');
		// GoalDetail.sessionId is the owning tdd task id (legacy column naming); the stale 0 must be gone.
		expect(frames.frames).toContain(
			`"data":{"type":"goal_started","sessionId":${frames.tddTaskId},"goalId":${frames.goalId}}`,
		);
		expect(frames.frames).not.toContain('"sessionId":0');
	});

	it("returns { ok: true } for malformed JSON and for an event the schema does not know", async () => {
		const malformed = await call("tdd_progress_push", { payload: "{not json" });
		expect(malformed.structuredContent).toEqual({ ok: true });
		const unknown = await call("tdd_progress_push", { payload: JSON.stringify({ type: "future_event" }) });
		expect(unknown.structuredContent).toEqual({ ok: true });
	});

	it("rejects a missing payload and an unknown key", async () => {
		expect((await call("tdd_progress_push", {})).isError).toBe(true);
		const unknown = await call("tdd_progress_push", { payload: "{}", event: "{}" });
		expect(unknown.isError).toBe(true);
		expect(text(unknown)).toContain("Accepted params");
	});
});

describe("run_tests (served schema only — the run itself is covered by the e2e/int suites)", () => {
	it("is listed as a non-read-only, non-destructive, non-idempotent tool that declares projectRoot, tags and passWithNoTests", async () => {
		const tool = (await listTools()).find((t) => t.name === "run_tests") as McpToolDescriptor;
		expect(tool).toBeDefined();
		expect(tool.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		});
		const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
		expect(Object.keys(properties).sort()).toEqual(
			["_sessionContext", "files", "passWithNoTests", "project", "projectRoot", "tags", "timeout"].sort(),
		);
		expect(tool.description).toContain("projectRoot");
		expect(tool.inputSchema.required).toBeUndefined();
		// Nested structs are strict at their own level (issue #243).
		// `tags` is an identified schema, served as a $ref into $defs; resolve it.
		const defs = tool.inputSchema.$defs as Record<string, Record<string, unknown>>;
		const tags = defs[String(properties.tags?.$ref).replace("#/$defs/", "")];
		expect(tags?.additionalProperties).toBe(false);
		expect(Object.keys(tags?.properties as object).sort()).toEqual(["all", "any", "none"]);
		expect(properties._sessionContext?.additionalProperties).toBe(false);
	});

	it("rejects an unknown parameter (testFiles) naming the accepted params instead of silently stripping it", async () => {
		const result = await call("run_tests", { testFiles: ["x.test.ts"] });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("testFiles");
		expect(text(result)).toContain("Accepted params");
		expect(text(result)).toContain("files");
	});

	it("rejects an unknown key nested inside tags, and inside _sessionContext, instead of emptying the filter", async () => {
		const tags = await call("run_tests", { tags: { anyy: ["unit"] } });
		expect(tags.isError).toBe(true);
		expect(text(tags)).toContain("anyy");
		expect(text(tags)).toContain("Accepted params");
		expect(text(tags)).toContain("any");
		const sessionContext = await call("run_tests", {
			_sessionContext: { chat_id: "x", conversationId: "y", mainAgentId: "z" },
		});
		expect(sessionContext.isError).toBe(true);
		expect(text(sessionContext)).toContain("chat_id");
	});

	it("still rejects a genuinely unknown key alongside projectRoot", async () => {
		const result = await call("run_tests", { projectRoot: "/tmp", bogus: 1 });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("bogus");
	});

	it("forwards a well-formed nested tags object to the handler, which refuses a shell-metachar tag before starting Vitest", async () => {
		const result = await call("run_tests", { tags: { any: ["unit; rm -rf /"] } });
		expect(result.isError).toBe(true);
		expect(text(result)).not.toContain("Unrecognized parameter");
		expect(text(result)).toContain("Unsafe argument rejected");
	});
});
