import { SqlClient } from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { DataStore } from "vitest-agent-sdk";
import type { McpContext } from "../../src/context.js";
import { createCallerFactory, createCurrentSessionIdRef } from "../../src/context.js";
import { appRouter } from "../../src/router.js";
import { test } from "./utils/fixtures.js";

describe("tdd_session_start integration", () => {
	test("same (sessionId, runId) returns the same id and marks replay on retry", async ({ runtime }) => {
		const caller = createCallerFactory(appRouter)({
			runtime: runtime as unknown as McpContext["runtime"],
			cwd: process.cwd(),
			currentSessionId: createCurrentSessionIdRef(null),
		});

		const sessionId = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "mcp-int-1",
					project: "test-project",
					cwd: "/workspace",
					agent_kind: "main",
					started_at: "2026-05-07T12:00:00.000Z",
				});
			}),
		);

		const first = await caller.tdd_session_start({
			sessionId,
			goal: "Implement the feature",
			runId: "run-mcp-1",
		});
		const second = await caller.tdd_session_start({
			sessionId,
			goal: "Implement the feature",
			runId: "run-mcp-1",
		});

		expect(first.id).toBe(second.id);
		expect((second as Record<string, unknown>)._idempotentReplay).toBe(true);
		expect((first as Record<string, unknown>)._idempotentReplay).toBeUndefined();
	});

	test("same (sessionId, runId) produces exactly 1 tdd_sessions row even without the middleware", async ({
		runtime,
	}) => {
		const count = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sql = yield* SqlClient;
				const sessionId = yield* store.writeSession({
					cc_session_id: "mcp-int-2",
					project: "test-project",
					cwd: "/workspace",
					agent_kind: "main",
					started_at: "2026-05-07T12:00:00.000Z",
				});
				yield* store.writeTddSession({
					sessionId,
					goal: "Refactor the module",
					startedAt: "2026-05-07T12:00:00.000Z",
					runId: "run-mcp-2",
				});
				yield* store.writeTddSession({
					sessionId,
					goal: "Refactor the module",
					startedAt: "2026-05-07T12:00:00.000Z",
					runId: "run-mcp-2",
				});
				const rows = yield* sql<{ count: number }>`
					SELECT COUNT(*) AS count FROM tdd_sessions
					WHERE session_id = ${sessionId} AND run_id = ${"run-mcp-2"}
				`;
				return rows[0].count;
			}),
		);
		expect(count).toBe(1);
	});

	test("blank runId is rejected", async ({ runtime }) => {
		const caller = createCallerFactory(appRouter)({
			runtime: runtime as unknown as McpContext["runtime"],
			cwd: process.cwd(),
			currentSessionId: createCurrentSessionIdRef(null),
		});

		const sessionId = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				return yield* store.writeSession({
					cc_session_id: "mcp-int-3",
					project: "test-project",
					cwd: "/workspace",
					agent_kind: "main",
					started_at: "2026-05-07T12:00:00.000Z",
				});
			}),
		);

		await expect(caller.tdd_session_start({ sessionId, goal: "Test blank runId", runId: "" })).rejects.toThrow();
	});

	test("absent runId produces a new row on each call at the DB level", async ({ runtime }) => {
		const [id1, id2, count] = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sql = yield* SqlClient;
				const sessionId = yield* store.writeSession({
					cc_session_id: "mcp-int-4",
					project: "test-project",
					cwd: "/workspace",
					agent_kind: "main",
					started_at: "2026-05-07T12:00:00.000Z",
				});
				const first = yield* store.writeTddSession({
					sessionId,
					goal: "Add more tests",
					startedAt: "2026-05-07T12:00:00.000Z",
				});
				const second = yield* store.writeTddSession({
					sessionId,
					goal: "Add more tests",
					startedAt: "2026-05-07T12:01:00.000Z",
				});
				const rows = yield* sql<{ count: number }>`
					SELECT COUNT(*) AS count FROM tdd_sessions
					WHERE session_id = ${sessionId}
				`;
				return [first, second, rows[0].count] as const;
			}),
		);
		expect(id1).not.toBe(id2);
		expect(count).toBe(2);
	});
});

describe("tdd_goal_create integration", () => {
	test("same (sessionId, goal) is idempotent via middleware", async ({ runtime }) => {
		const caller = createCallerFactory(appRouter)({
			runtime: runtime as unknown as McpContext["runtime"],
			cwd: process.cwd(),
			currentSessionId: createCurrentSessionIdRef(null),
		});

		const tddSessionId = await runtime.runPromise(
			Effect.gen(function* () {
				const store = yield* DataStore;
				const sessionId = yield* store.writeSession({
					cc_session_id: "mcp-int-5",
					project: "test-project",
					cwd: "/workspace",
					agent_kind: "main",
					started_at: "2026-05-07T12:00:00.000Z",
				});
				return yield* store.writeTddSession({
					sessionId,
					goal: "Parent TDD session",
					startedAt: "2026-05-07T12:00:00.000Z",
					runId: "run-mcp-5",
				});
			}),
		);

		const first = await caller.tdd_goal_create({
			sessionId: tddSessionId,
			goal: "Write unit tests for the parser",
		});
		const second = await caller.tdd_goal_create({
			sessionId: tddSessionId,
			goal: "Write unit tests for the parser",
		});

		expect(first).toMatchObject({ ok: true });
		expect(second).toMatchObject({ ok: true, _idempotentReplay: true });
		expect((first as Record<string, unknown>).goal).toEqual((second as Record<string, unknown>).goal);
	});
});
