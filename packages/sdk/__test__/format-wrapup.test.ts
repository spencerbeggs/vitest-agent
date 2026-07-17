import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";
import { DataStoreError } from "../src/errors/DataStoreError.js";
import { DataReaderLive } from "../src/layers/DataReaderLive.js";
import { DataStoreLive } from "../src/layers/DataStoreLive.js";
import { formatWrapupEffect } from "../src/lib/format-wrapup.js";
import migration0001 from "../src/migrations/0001_initial.js";

import { DataReader } from "../src/services/DataReader.js";
import { DataStore } from "../src/services/DataStore.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeServices.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
	}),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(
	DataStoreLive.pipe(Layer.provide(SqliteLayer)),
	DataReaderLive.pipe(Layer.provide(SqliteLayer)),
	MigratorLayer,
	SqliteLayer,
	PlatformLayer,
);

const run = <A, E>(effect: Effect.Effect<A, E, DataStore | DataReader | SqlClient>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

describe("formatWrapupEffect", () => {
	describe("user_prompt_nudge", () => {
		it("returns empty string when prompt is unrelated to test failure", async () => {
			const result = await run(formatWrapupEffect({ kind: "user_prompt_nudge", userPromptHint: "add a feature" }));
			expect(result).toBe("");
		});

		it("returns the failure-related nudge when prompt mentions test failure", async () => {
			const result = await run(
				formatWrapupEffect({ kind: "user_prompt_nudge", userPromptHint: "fix the broken test in foo.test.ts" }),
			);
			expect(result).toContain("test_history");
			expect(result).toContain("failure_signature_get");
		});

		it("matches 'why is this failing' style prompts", async () => {
			const result = await run(
				formatWrapupEffect({ kind: "user_prompt_nudge", userPromptHint: "Why is this failing in CI?" }),
			);
			expect(result).toContain("vitest-agent-nudge");
		});
	});

	describe("session_end", () => {
		it("returns empty string for a quiet session (no edits, no hypotheses)", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-empty",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "session_end" });
				}),
			);
			expect(result).toBe("");
		});

		it("nudges for hypothesis recording when recent file_edits exist", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-edits",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/foo.ts", edit_kind: "edit" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "session_end" });
				}),
			);
			expect(result).toContain("Session wrap-up");
			expect(result).toMatch(/hypothesis|record/i);
			expect(result).toContain('note({ action: "create" })');
		});

		it("resolves the session via chatId when sessionId is omitted", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-resolve",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/bar.ts", edit_kind: "write" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ chatId: "cc-resolve", kind: "session_end" });
				}),
			);
			expect(result).toContain("Session wrap-up");
		});
	});

	describe("stop", () => {
		it("uses 'Before you finish' heading instead of 'Session wrap-up'", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-stop",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/baz.ts", edit_kind: "edit" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "stop" });
				}),
			);
			expect(result).toContain("Before you finish");
			expect(result).not.toContain('note({ action: "create" })');
		});
	});

	describe("pre_compact", () => {
		it("includes the 'what matters next' nudge", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-precompact",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/qux.ts", edit_kind: "edit" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "pre_compact" });
				}),
			);
			expect(result).toContain("matters next");
		});
	});

	describe("tdd_handoff", () => {
		it("emits the structured handoff format for a TDD subagent finish", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sql = yield* SqlClient;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-tdd",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						agentType: "tdd-orchestrator",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* sql`
						INSERT INTO tdd_tasks (id, session_id, goal, started_at, ended_at, outcome)
						VALUES (1, ${sessionId}, 'add login validation', '2026-04-30T00:00:00Z', '2026-04-30T00:01:00Z', 'succeeded')
					`;
					return yield* formatWrapupEffect({ sessionId, kind: "tdd_handoff" });
				}),
			);
			expect(result).toContain("tdd-orchestrator");
			expect(result).toContain("add login validation");
			expect(result).toContain("succeeded");
			expect(result).toContain("/tdd resume:1");
		});

		it("returns empty string when no tdd session metadata is recorded (skip injection)", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-tdd-empty",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						agentType: "tdd-orchestrator",
						startedAt: "2026-04-30T00:00:00Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "tdd_handoff" });
				}),
			);
			expect(result).toBe("");
		});
	});

	describe("open-hypothesis branch", () => {
		it("includes the open-hypothesis nudge when listHypotheses returns rows with validationOutcome=null", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-open-hyp",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "subagent",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeHypothesis({
						sessionId,
						content: "the foo handler is dropping the bar argument",
					});
					yield* ds.writeHypothesis({
						sessionId,
						content: "the cache is not being invalidated on writes",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "stop" });
				}),
			);
			expect(result).toContain("Before you finish");
			expect(result).toContain("open hypothesis");
			expect(result).toContain('hypothesis({ action: "validate"');
			expect(result).toContain("2");
		});
	});

	describe("main-agent suppression", () => {
		it("returns empty for stop on a main session with file edits and no hypotheses", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-main-stop",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/foo.ts", edit_kind: "edit" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "stop" });
				}),
			);
			expect(result).toBe("");
		});

		it("suppresses the open-hypothesis line on a main session", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-main-open-hyp",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeHypothesis({
						sessionId,
						content: "main agent recorded a hypothesis somehow",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "stop" });
				}),
			);
			expect(result).toBe("");
		});

		it("still emits the note_create line for session_end on a main session with edits", async () => {
			const result = await run(
				Effect.gen(function* () {
					const ds = yield* DataStore;
					const sessionId = yield* ds.writeSession({
						chatId: "cc-main-end",
						project: "p",
						cwd: "/tmp/p",
						agentKind: "main",
						startedAt: "2026-04-30T00:00:00Z",
					});
					yield* ds.writeTurn({
						sessionId: sessionId,
						type: "file_edit",
						payload: JSON.stringify({ type: "file_edit", file_path: "/abs/src/bar.ts", edit_kind: "edit" }),
						occurredAt: "2026-04-30T00:00:01Z",
					});
					return yield* formatWrapupEffect({ sessionId, kind: "session_end" });
				}),
			);
			expect(result).toContain("Session wrap-up");
			expect(result).toContain('note({ action: "create" })');
			expect(result).not.toContain('hypothesis({ action: "record" })');
		});
	});

	describe("DataReader error fallbacks", () => {
		it("swallows DataReader errors and still returns a string for every kind that calls a reader", async () => {
			// Construct a DataReader test layer where every method called by
			// formatWrapupEffect fails, exercising the four `Effect.orElseSucceed`
			// arrow-function fallbacks (lines 60, 69, 86, 88 of format-wrapup.ts).
			const failingReader = DataReader.of({
				getSessionById: () => Effect.fail(new DataStoreError({ operation: "read", table: "sessions", reason: "boom" })),
				getSessionByChatId: () =>
					Effect.fail(new DataStoreError({ operation: "read", table: "sessions", reason: "boom" })),
				getTddTaskById: () =>
					Effect.fail(new DataStoreError({ operation: "read", table: "tdd_tasks", reason: "boom" })),
				searchTurns: () => Effect.fail(new DataStoreError({ operation: "read", table: "turns", reason: "boom" })),
				listHypotheses: () =>
					Effect.fail(new DataStoreError({ operation: "read", table: "hypotheses", reason: "boom" })),
				// Unused methods can be left as `null as never` since formatWrapupEffect
				// never reaches them.
			} as unknown as DataReader["Service"]);
			const FailingReaderLayer = Layer.succeed(DataReader, failingReader);

			// Drive line 60 (getSessionByChatId fallback): pass chatId, force the
			// Option.none() fallback so sessionId stays null and we early-return "".
			const ccResolveResult = await Effect.runPromise(
				Effect.provide(formatWrapupEffect({ chatId: "cc-fails", kind: "stop" }), FailingReaderLayer),
			);
			expect(ccResolveResult).toBe("");

			// Drive line 69 (getTddTaskById fallback): tdd_handoff kind with a
			// sessionId. The fallback yields Option.none() and the function returns "".
			const tddHandoffResult = await Effect.runPromise(
				Effect.provide(formatWrapupEffect({ sessionId: 42, kind: "tdd_handoff" }), FailingReaderLayer),
			);
			expect(tddHandoffResult).toBe("");

			// Drive lines 86 + 88 (searchTurns + listHypotheses fallbacks): non-tdd_handoff
			// kind with an explicit sessionId so we skip the cc-resolve branch and reach
			// the bottom of the function. Both readers fail and fall back to []; with no
			// file_edits and no open hypotheses, the function returns "".
			const stopResult = await Effect.runPromise(
				Effect.provide(formatWrapupEffect({ sessionId: 42, kind: "stop" }), FailingReaderLayer),
			);
			expect(stopResult).toBe("");
		});
	});
});
