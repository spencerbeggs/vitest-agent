import { SqlClient } from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { DataStore } from "vitest-agent-sdk";
import { test } from "./utils/fixtures.js";

describe("DataStore integration", () => {
	describe("writeTddTask", () => {
		test("same (sessionId, runId) returns the same numeric id", async ({ runtime }) => {
			const [id1, id2] = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sessionId = yield* store.writeSession({
						chatId: "cc-int-1",
						project: "test-project",
						cwd: "/workspace",
						agentKind: "main",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					const first = yield* store.writeTddTask({
						sessionId,
						goal: "Implement the feature",
						startedAt: "2026-05-07T12:00:00.000Z",
						runId: "run-abc-1",
					});
					const second = yield* store.writeTddTask({
						sessionId,
						goal: "Implement the feature",
						startedAt: "2026-05-07T12:00:00.000Z",
						runId: "run-abc-1",
					});
					return [first, second] as const;
				}),
			);
			expect(id1).toBe(id2);
		});

		test("same (sessionId, runId) produces exactly 1 row in tdd_tasks", async ({ runtime }) => {
			const count = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sql = yield* SqlClient;
					const sessionId = yield* store.writeSession({
						chatId: "cc-int-2",
						project: "test-project",
						cwd: "/workspace",
						agentKind: "main",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					yield* store.writeTddTask({
						sessionId,
						goal: "Refactor the module",
						startedAt: "2026-05-07T12:00:00.000Z",
						runId: "run-abc-2",
					});
					yield* store.writeTddTask({
						sessionId,
						goal: "Refactor the module",
						startedAt: "2026-05-07T12:00:00.000Z",
						runId: "run-abc-2",
					});
					yield* store.writeTddTask({
						sessionId,
						goal: "Refactor the module",
						startedAt: "2026-05-07T12:00:00.000Z",
						runId: "run-abc-2",
					});
					const rows = yield* sql<{ count: number }>`
						SELECT COUNT(*) AS count FROM tdd_tasks
						WHERE session_id = ${sessionId} AND run_id = ${"run-abc-2"}
					`;
					return rows[0].count;
				}),
			);
			expect(count).toBe(1);
		});

		test("absent runId produces a new row on each call", async ({ runtime }) => {
			const [id1, id2, count] = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sql = yield* SqlClient;
					const sessionId = yield* store.writeSession({
						chatId: "cc-int-3",
						project: "test-project",
						cwd: "/workspace",
						agentKind: "main",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					const first = yield* store.writeTddTask({
						sessionId,
						goal: "Add more tests",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					const second = yield* store.writeTddTask({
						sessionId,
						goal: "Add more tests",
						startedAt: "2026-05-07T12:01:00.000Z",
					});
					const rows = yield* sql<{ count: number }>`
						SELECT COUNT(*) AS count FROM tdd_tasks
						WHERE session_id = ${sessionId}
					`;
					return [first, second, rows[0].count] as const;
				}),
			);
			expect(id1).not.toBe(id2);
			expect(count).toBe(2);
		});
	});

	describe("writeTurn", () => {
		test("mcp-prefixed tool_name is normalized to the short form", async ({ runtime }) => {
			const toolName = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sql = yield* SqlClient;
					const sessionId = yield* store.writeSession({
						chatId: "cc-int-4",
						project: "test-project",
						cwd: "/workspace",
						agentKind: "main",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					const turnId = yield* store.writeTurn({
						sessionId: sessionId,
						type: "tool_result",
						payload: JSON.stringify({
							tool_name: "mcp__vitest_agent__test_status",
							result_summary: "ok",
							duration_ms: 100,
							success: true,
						}),
						occurredAt: "2026-05-07T12:00:00.000Z",
					});
					const rows = yield* sql<{ tool_name: string }>`
						SELECT tool_name FROM tool_invocations WHERE turn_id = ${turnId}
					`;
					return rows[0].tool_name;
				}),
			);
			expect(toolName).toBe("test_status");
		});

		test("non-mcp tool_name with double underscores is stored as-is", async ({ runtime }) => {
			const toolName = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const sql = yield* SqlClient;
					const sessionId = yield* store.writeSession({
						chatId: "cc-int-5",
						project: "test-project",
						cwd: "/workspace",
						agentKind: "main",
						startedAt: "2026-05-07T12:00:00.000Z",
					});
					const turnId = yield* store.writeTurn({
						sessionId: sessionId,
						type: "tool_result",
						payload: JSON.stringify({
							tool_name: "some__double__underscore",
							result_summary: "ok",
							duration_ms: 50,
							success: true,
						}),
						occurredAt: "2026-05-07T12:00:00.000Z",
					});
					const rows = yield* sql<{ tool_name: string }>`
						SELECT tool_name FROM tool_invocations WHERE turn_id = ${turnId}
					`;
					return rows[0].tool_name;
				}),
			);
			expect(toolName).toBe("some__double__underscore");
		});
	});

	describe("ensureFile", () => {
		test("is idempotent within a single Effect.gen", async ({ runtime }) => {
			const [id1, id2] = await runtime.runPromise(
				Effect.gen(function* () {
					const store = yield* DataStore;
					const first = yield* store.ensureFile("/path/to/test.ts");
					const second = yield* store.ensureFile("/path/to/test.ts");
					return [first, second] as const;
				}),
			);
			expect(id1).toBe(id2);
		});
	});
});
