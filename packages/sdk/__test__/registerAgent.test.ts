import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import migration0001 from "../src/migrations/0001_initial.js";
import type { Agent, IdempotencyHit } from "../src/schemas/Agent.js";
import { DataStore } from "../src/services/DataStore.js";
import { deriveIdempotencyKey } from "../src/services/idempotency.js";

const makeLayer = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const PlatformLayer = NodeServices.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(DataStoreLive.pipe(Layer.provide(SqliteLayer)), MigratorLayer, SqliteLayer, PlatformLayer);
};

const seedSession = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (1, 'cc-session-uuid', 'p', '/c', 'main', '2026-01-01')`;
});

const idempotencyKey = (agentType: string, parentAgentId: string | null, clientNonce: string) =>
	deriveIdempotencyKey({ agentType, parentAgentId, clientNonce });

describe("DataStore.registerAgent", () => {
	it("inserts a new agents row and returns an Agent", async () => {
		const program = Effect.gen(function* () {
			yield* seedSession;
			const store = yield* DataStore;
			return yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 1700000000,
				startGitBranch: "main",
				startGitCommitSha: "abc",
				startWorktreeDir: "/repo",
				idempotencyKey: idempotencyKey("claude-code-main", null, "n1"),
			});
		}).pipe(Effect.provide(makeLayer()));
		const result = await Effect.runPromise(program);
		expect(result._tag).toBe("Agent");
		expect((result as Agent).agentType).toBe("claude-code-main");
		expect((result as Agent).sessionId).toBe(1);
	});

	it("returns IdempotencyHit when called twice with the same idempotency_key in a session", async () => {
		const key = idempotencyKey("claude-code-main", null, "n1");
		const program = Effect.gen(function* () {
			yield* seedSession;
			const store = yield* DataStore;
			const first = yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 1700000000,
				idempotencyKey: key,
			});
			const second = yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 1700000000,
				idempotencyKey: key,
			});
			return [first, second];
		}).pipe(Effect.provide(makeLayer()));
		const [first, second] = await Effect.runPromise(program);
		expect(first._tag).toBe("Agent");
		expect(second._tag).toBe("IdempotencyHit");
		expect((second as IdempotencyHit).existingAgentId).toBe((first as Agent).agentId);
	});

	it("two different idempotency keys produce two distinct agent rows", async () => {
		const program = Effect.gen(function* () {
			yield* seedSession;
			const store = yield* DataStore;
			const a = yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-tdd-task",
				parentAgentId: null,
				conversationId: null,
				startedAt: 0,
				idempotencyKey: idempotencyKey("claude-code-tdd-task", null, "sib-A"),
			});
			const b = yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-tdd-task",
				parentAgentId: null,
				conversationId: null,
				startedAt: 0,
				idempotencyKey: idempotencyKey("claude-code-tdd-task", null, "sib-B"),
			});
			return [a, b];
		}).pipe(Effect.provide(makeLayer()));
		const [a, b] = await Effect.runPromise(program);
		expect(a._tag).toBe("Agent");
		expect(b._tag).toBe("Agent");
		expect((a as Agent).agentId).not.toBe((b as Agent).agentId);
	});

	it("subagent registration sets parent_agent_id correctly", async () => {
		const program = Effect.gen(function* () {
			yield* seedSession;
			const store = yield* DataStore;
			const main = (yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 0,
				idempotencyKey: idempotencyKey("claude-code-main", null, "n1"),
			})) as Agent;
			const sub = (yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-tdd-task",
				parentAgentId: main.agentId,
				conversationId: null,
				startedAt: 1,
				idempotencyKey: idempotencyKey("claude-code-tdd-task", main.agentId, "sub-1"),
			})) as Agent;
			return { main, sub };
		}).pipe(Effect.provide(makeLayer()));
		const { main, sub } = await Effect.runPromise(program);
		expect(sub.parentAgentId).toBe(main.agentId);
	});

	it("accepts a subagent whose parent agent lives in the parent session", async () => {
		// Real subagent topology: a per-dispatch subagent session (2) whose
		// parent_session_id points at the main session (1). The parent agent
		// lives in session 1; the subagent registers under session 2. A strict
		// same-session check wrongly rejected this (dogfood is-prime-coverage).
		const program = Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (1, 'main-uuid', 'p', '/c', 'main', '2026-01-01')`;
			yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at, parent_session_id) VALUES (2, 'main-uuid-subagent-1-2', 'p', '/c', 'subagent', '2026-01-01', 1)`;
			const store = yield* DataStore;
			const main = (yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 0,
				idempotencyKey: idempotencyKey("claude-code-main", null, "n1"),
			})) as Agent;
			const sub = (yield* store.registerAgent({
				sessionId: 2,
				agentType: "claude-code-tdd-task",
				parentAgentId: main.agentId,
				conversationId: null,
				startedAt: 1,
				idempotencyKey: idempotencyKey("claude-code-tdd-task", main.agentId, "sub-1"),
			})) as Agent;
			return { main, sub };
		}).pipe(Effect.provide(makeLayer()));
		const { main, sub } = await Effect.runPromise(program);
		expect(sub._tag).toBe("Agent");
		expect(sub.sessionId).toBe(2);
		expect(sub.parentAgentId).toBe(main.agentId);
	});

	it("rejects a parent agent that belongs to neither the registering session nor its parent", async () => {
		// Session 2 has no parent_session_id; the parent agent lives in the
		// unrelated session 1. This must still be rejected.
		const program = Effect.gen(function* () {
			const sql = yield* SqlClient;
			yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (1, 'a-uuid', 'p', '/c', 'main', '2026-01-01')`;
			yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (2, 'b-uuid', 'p', '/c', 'main', '2026-01-01')`;
			const store = yield* DataStore;
			const stranger = (yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: null,
				startedAt: 0,
				idempotencyKey: idempotencyKey("claude-code-main", null, "n1"),
			})) as Agent;
			return yield* store.registerAgent({
				sessionId: 2,
				agentType: "claude-code-tdd-task",
				parentAgentId: stranger.agentId,
				conversationId: null,
				startedAt: 1,
				idempotencyKey: idempotencyKey("claude-code-tdd-task", stranger.agentId, "x"),
			});
		}).pipe(Effect.provide(makeLayer()));
		const exit = await Effect.runPromiseExit(program);
		expect(exit._tag).toBe("Failure");
	});

	it("populates conversation_id and start_git_* columns when supplied", async () => {
		const program = Effect.gen(function* () {
			const sql = yield* SqlClient;
			// Seed session with conversation_id at INSERT (the immutability
			// trigger forbids UPDATE).
			yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at, conversation_id) VALUES (1, 'cc-session-uuid', 'p', '/c', 'main', '2026-01-01', '550e8400-e29b-41d4-a716-446655440000')`;
			const store = yield* DataStore;
			const agent = (yield* store.registerAgent({
				sessionId: 1,
				agentType: "claude-code-main",
				parentAgentId: null,
				conversationId: "550e8400-e29b-41d4-a716-446655440000",
				startedAt: 1700000000,
				startGitBranch: "feat/x",
				startGitCommitSha: "deadbeef",
				startWorktreeDir: "/work",
				idempotencyKey: idempotencyKey("claude-code-main", null, "n1"),
			})) as Agent;
			return agent;
		}).pipe(Effect.provide(makeLayer()));
		const agent = await Effect.runPromise(program);
		expect(agent.conversationId).toBe("550e8400-e29b-41d4-a716-446655440000");
		expect(agent.startGitBranch).toBe("feat/x");
		expect(agent.startGitCommitSha).toBe("deadbeef");
		expect(agent.startWorktreeDir).toBe("/work");
	});
});
