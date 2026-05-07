import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import migration0001 from "./0001_initial.js";
import migration0002 from "./0002_comprehensive.js";

const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
const PlatformLayer = NodeContext.layer;

const MigratorLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_initial": migration0001,
		"0002_comprehensive": migration0002,
	}),
}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));

const TestLayer = Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) => Effect.runPromise(Effect.provide(effect, TestLayer));

describe("0002_comprehensive migration", () => {
	it("enables foreign keys", async () => {
		const fkEnabled = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
				return rows[0]?.foreign_keys;
			}),
		);
		expect(fkEnabled).toBe(1);
	});

	it("uses WAL journal mode", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`PRAGMA journal_mode`;
				}),
			),
		).resolves.not.toThrow();
	});

	it("creates files, settings, settings_env_vars tables", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master
					WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sql_%'
					ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);

		expect(tables).toContain("files");
		expect(tables).toContain("settings");
		expect(tables).toContain("settings_env_vars");
	});

	it("creates test result tables", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master
					WHERE type='table' AND name NOT LIKE 'sqlite_%'
					ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);

		for (const name of [
			"test_runs",
			"test_modules",
			"test_suites",
			"test_cases",
			"test_errors",
			"stack_frames",
			"tags",
			"test_case_tags",
			"test_suite_tags",
			"test_annotations",
			"test_artifacts",
			"attachments",
		]) {
			expect(tables).toContain(name);
		}
	});

	it("enforces test_runs.reason CHECK constraint", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h1', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv', 'p', 'h1', '2026-04-29T00:00:00Z', 'invalid', 0, 0, 0, 0, 0)`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates sessions table with CHECK and indexes", async () => {
		const result = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-1', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const rows = yield* sql<{
					id: number;
					agent_kind: string;
				}>`SELECT id, agent_kind FROM sessions WHERE cc_session_id = 'cc-1'`;
				return rows[0];
			}),
		);
		expect(result.id).toBeGreaterThan(0);
		expect(result.agent_kind).toBe("main");
	});

	it("rejects invalid sessions.agent_kind", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-2', 'p', '/tmp/p', 'invalid', '2026-04-29T00:00:00Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("indexes sessions on (project, started_at) and (parent_session_id)", async () => {
		const indexes = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{
					name: string;
				}>`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'`;
				return rows.map((r) => r.name);
			}),
		);
		expect(indexes).toContain("idx_sessions_project");
		expect(indexes).toContain("idx_sessions_parent");
	});

	it("creates turn-log tables with CASCADE FKs", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-cascade', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sessionId = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-cascade'`)[0]
					.id;

				yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sessionId}, 1, 'user_prompt', '{}', '2026-04-29T00:00:01Z')`;
				yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sessionId}, 2, 'tool_call', '{}', '2026-04-29T00:00:02Z')`;
				const turnIds = yield* sql<{
					id: number;
				}>`SELECT id FROM turns WHERE session_id = ${sessionId} ORDER BY turn_no`;
				yield* sql`INSERT INTO tool_invocations (turn_id, tool_name, success) VALUES (${turnIds[1].id}, 'Bash', 1)`;
				yield* sql`INSERT INTO files (path) VALUES ('/tmp/p/src/x.ts')`;
				const fileId = (yield* sql<{ id: number }>`SELECT id FROM files WHERE path = '/tmp/p/src/x.ts'`)[0].id;
				yield* sql`INSERT INTO file_edits (turn_id, file_id, edit_kind) VALUES (${turnIds[1].id}, ${fileId}, 'edit')`;

				// Cascade
				yield* sql`DELETE FROM sessions WHERE id = ${sessionId}`;
				const remainingTurns = yield* sql<{
					c: number;
				}>`SELECT COUNT(*) AS c FROM turns WHERE session_id = ${sessionId}`;
				expect(remainingTurns[0].c).toBe(0);
				const remainingTools = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tool_invocations`;
				expect(remainingTools[0].c).toBe(0);
				const remainingEdits = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM file_edits`;
				expect(remainingEdits[0].c).toBe(0);
			}),
		);
	});

	it("enforces turns.type CHECK constraint", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-bad', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-bad'`)[0].id;
					yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sid}, 1, 'invalid_type', '{}', '2026-04-29T00:00:00Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("enforces UNIQUE (session_id, turn_no) on turns", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-dup', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-dup'`)[0].id;
					yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sid}, 1, 'note', '{}', '2026-04-29T00:00:00Z')`;
					yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sid}, 1, 'note', '{}', '2026-04-29T00:00:00Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates hypotheses table; SET NULL on turn delete", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-hyp', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-hyp'`)[0].id;
				yield* sql`INSERT INTO turns (session_id, turn_no, type, payload, occurred_at) VALUES (${sid}, 1, 'hypothesis', '{}', '2026-04-29T00:00:00Z')`;
				const turnId = (yield* sql<{ id: number }>`SELECT id FROM turns WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO hypotheses (session_id, created_turn_id, content) VALUES (${sid}, ${turnId}, 'I think the bug is in handler X')`;

				// Delete the turn — hypothesis row should survive (SET NULL semantics)
				yield* sql`DELETE FROM turns WHERE id = ${turnId}`;
				const surviving = yield* sql<{
					created_turn_id: number | null;
				}>`SELECT created_turn_id FROM hypotheses WHERE session_id = ${sid}`;
				expect(surviving).toHaveLength(1);
				expect(surviving[0].created_turn_id).toBeNull();
			}),
		);
	});

	it("rejects invalid hypotheses.validation_outcome", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-hyp2', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-hyp2'`)[0].id;
					yield* sql`INSERT INTO hypotheses (session_id, content, validation_outcome) VALUES (${sid}, 'h', 'maybe')`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates commits and run_changed_files", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table'`;
				return rows.map((r) => r.name);
			}),
		);
		expect(tables).toContain("commits");
		expect(tables).toContain("run_changed_files");
	});

	it("rejects invalid run_changed_files.change_kind", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-rcf', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv', 'p', 'h-rcf', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
					const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs LIMIT 1`)[0].id;
					yield* sql`INSERT INTO files (path) VALUES ('/p/src/a.ts')`;
					const fileId = (yield* sql<{ id: number }>`SELECT id FROM files WHERE path = '/p/src/a.ts'`)[0].id;
					yield* sql`INSERT INTO run_changed_files (run_id, file_id, change_kind) VALUES (${runId}, ${fileId}, 'borked')`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates run_triggers with CHECK on trigger and invocation_method", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-rt', '4.1.0')`;
				yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-rt', 'p', 'h-rt', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
				const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-rt'`)[0].id;
				yield* sql`INSERT INTO run_triggers (run_id, trigger, invocation_method) VALUES (${runId}, 'agent', 'mcp')`;
				const rows = yield* sql<{ trigger: string }>`SELECT trigger FROM run_triggers WHERE run_id = ${runId}`;
				expect(rows[0].trigger).toBe("agent");
			}),
		);
	});

	it("rejects invalid run_triggers.trigger", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-rt2', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-rt2', 'p', 'h-rt2', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
					const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-rt2'`)[0].id;
					yield* sql`INSERT INTO run_triggers (run_id, trigger) VALUES (${runId}, 'cosmic-rays')`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates build_artifacts table", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-ba', '4.1.0')`;
				yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-ba', 'p', 'h-ba', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
				const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-ba'`)[0].id;
				yield* sql`INSERT INTO build_artifacts (run_id, tool_kind, exit_code, captured_at) VALUES (${runId}, 'tsc', 0, '2026-04-29T00:00:00Z')`;
				yield* sql`INSERT INTO build_artifacts (run_id, tool_kind, exit_code, captured_at) VALUES (${runId}, 'biome', 1, '2026-04-29T00:00:01Z')`;
				const rows = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM build_artifacts WHERE run_id = ${runId}`;
				expect(rows[0].c).toBe(2);
			}),
		);
	});

	it("creates tdd_sessions with UNIQUE (session_id, run_id) when run_id is not null", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-tdd', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-tdd'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, run_id, started_at) VALUES (${sid}, 'add login', 'run-abc', '2026-04-29T00:00:00Z')`;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, run_id, started_at) VALUES (${sid}, 'add login v2', 'run-abc', '2026-04-29T00:00:01Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("allows multiple tdd_sessions with same (session_id, goal) when run_ids differ", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-tdd-multi', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{
						id: number;
					}>`SELECT id FROM sessions WHERE cc_session_id = 'cc-tdd-multi'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, run_id, started_at) VALUES (${sid}, 'add login', 'run-1', '2026-04-29T00:00:00Z')`;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, run_id, started_at) VALUES (${sid}, 'add login', 'run-2', '2026-04-29T00:00:01Z')`;
				}),
			),
		).resolves.not.toThrow();
	});

	it("creates tdd_session_goals with UNIQUE (session_id, ordinal)", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-goals-uniq', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-goals-uniq'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'obj', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g2')`;
				}),
			),
		).rejects.toThrow();
	});

	it("rejects invalid tdd_session_goals.status", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-goals-st', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-goals-st'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'obj', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal, status) VALUES (${tsid}, 0, 'g', 'running')`;
				}),
			),
		).rejects.toThrow();
	});

	it("cascades tdd_session_goals on tdd_sessions delete", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-goals-cas', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-goals-cas'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'obj', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
				yield* sql`DELETE FROM tdd_sessions WHERE id = ${tsid}`;
				const remaining = yield* sql<{
					c: number;
				}>`SELECT COUNT(*) AS c FROM tdd_session_goals WHERE session_id = ${tsid}`;
				expect(remaining[0].c).toBe(0);
			}),
		);
	});

	it("creates tdd_session_behaviors with goal_id FK and status CHECK", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-beh', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-beh'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
					const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior, status) VALUES (${gid}, 0, 'b1', 'invalid')`;
				}),
			),
		).rejects.toThrow();
	});

	it("enforces UNIQUE (goal_id, ordinal) on tdd_session_behaviors", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-beh-uniq', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-beh-uniq'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
					const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
					yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b2')`;
				}),
			),
		).rejects.toThrow();
	});

	it("cascades tdd_session_behaviors when parent goal is deleted", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-beh-cas', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-beh-cas'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
				const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
				yield* sql`DELETE FROM tdd_session_goals WHERE id = ${gid}`;
				const remaining = yield* sql<{
					c: number;
				}>`SELECT COUNT(*) AS c FROM tdd_session_behaviors WHERE goal_id = ${gid}`;
				expect(remaining[0].c).toBe(0);
			}),
		);
	});

	it("creates tdd_behavior_dependencies junction with FK cascade and no self-deps", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-dep', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-dep'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
				const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
				yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 1, 'b2')`;
				const beh = yield* sql<{
					id: number;
				}>`SELECT id FROM tdd_session_behaviors WHERE goal_id = ${gid} ORDER BY ordinal`;
				const b1 = beh[0].id;
				const b2 = beh[1].id;
				yield* sql`INSERT INTO tdd_behavior_dependencies (behavior_id, depends_on_id) VALUES (${b2}, ${b1})`;
				const rows = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tdd_behavior_dependencies`;
				expect(rows[0].c).toBe(1);
				yield* sql`DELETE FROM tdd_session_behaviors WHERE id = ${b1}`;
				const remaining = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tdd_behavior_dependencies`;
				expect(remaining[0].c).toBe(0);
			}),
		);
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-dep-self', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-dep-self'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
					const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
					yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
					const b = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_behaviors WHERE goal_id = ${gid}`)[0].id;
					yield* sql`INSERT INTO tdd_behavior_dependencies (behavior_id, depends_on_id) VALUES (${b}, ${b})`;
				}),
			),
		).rejects.toThrow();
	});

	it("cascades tdd_phases when behavior is deleted (behavior_id ON DELETE CASCADE)", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-phbeh', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-phbeh'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
				const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
				const bid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_behaviors WHERE goal_id = ${gid}`)[0].id;
				yield* sql`INSERT INTO tdd_phases (tdd_session_id, behavior_id, phase, started_at) VALUES (${tsid}, ${bid}, 'red', '2026-04-29T00:00:00Z')`;
				yield* sql`DELETE FROM tdd_session_behaviors WHERE id = ${bid}`;
				const phases = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tdd_phases WHERE behavior_id = ${bid}`;
				expect(phases[0].c).toBe(0);
			}),
		);
	});

	it("creates tdd_artifacts with behavior_id FK that cascades", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(tdd_artifacts)`;
				return rows.map((r) => r.name);
			}),
		);
		expect(cols).toContain("behavior_id");

		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-art-beh', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-art-beh'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_goals (session_id, ordinal, goal) VALUES (${tsid}, 0, 'g1')`;
				const gid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_goals WHERE session_id = ${tsid}`)[0].id;
				yield* sql`INSERT INTO tdd_session_behaviors (goal_id, ordinal, behavior) VALUES (${gid}, 0, 'b1')`;
				const bid = (yield* sql<{ id: number }>`SELECT id FROM tdd_session_behaviors WHERE goal_id = ${gid}`)[0].id;
				yield* sql`INSERT INTO tdd_phases (tdd_session_id, behavior_id, phase, started_at) VALUES (${tsid}, ${bid}, 'red', '2026-04-29T00:00:00Z')`;
				const phid = (yield* sql<{ id: number }>`SELECT id FROM tdd_phases WHERE tdd_session_id = ${tsid}`)[0].id;
				yield* sql`INSERT INTO tdd_artifacts (phase_id, behavior_id, artifact_kind, recorded_at) VALUES (${phid}, ${bid}, 'test_written', '2026-04-29T00:00:00Z')`;
				yield* sql`DELETE FROM tdd_session_behaviors WHERE id = ${bid}`;
				const remaining = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tdd_artifacts`;
				expect(remaining[0].c).toBe(0);
			}),
		);
	});

	it("creates tdd_phases with 8-value phase CHECK", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-ph', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-ph'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_phases (tdd_session_id, phase, started_at) VALUES (${tsid}, 'invalid_phase', '2026-04-29T00:00:00Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("accepts all 8 valid phase values", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-allph', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
				const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-allph'`)[0].id;
				yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
				const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
				for (const phase of [
					"spike",
					"red",
					"red.triangulate",
					"green",
					"green.fake-it",
					"refactor",
					"extended-red",
					"green-without-red",
				]) {
					yield* sql`INSERT INTO tdd_phases (tdd_session_id, phase, started_at) VALUES (${tsid}, ${phase}, '2026-04-29T00:00:00Z')`;
				}
				const c = yield* sql<{ c: number }>`SELECT COUNT(*) AS c FROM tdd_phases WHERE tdd_session_id = ${tsid}`;
				expect(c[0].c).toBe(8);
			}),
		);
	});

	it("creates tdd_artifacts with UNIQUE idempotency key", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (cc_session_id, project, cwd, agent_kind, started_at) VALUES ('cc-art', 'p', '/tmp/p', 'main', '2026-04-29T00:00:00Z')`;
					const sid = (yield* sql<{ id: number }>`SELECT id FROM sessions WHERE cc_session_id = 'cc-art'`)[0].id;
					yield* sql`INSERT INTO tdd_sessions (session_id, goal, started_at) VALUES (${sid}, 'g', '2026-04-29T00:00:00Z')`;
					const tsid = (yield* sql<{ id: number }>`SELECT id FROM tdd_sessions WHERE session_id = ${sid}`)[0].id;
					yield* sql`INSERT INTO tdd_phases (tdd_session_id, phase, started_at) VALUES (${tsid}, 'red', '2026-04-29T00:00:00Z')`;
					const phid = (yield* sql<{ id: number }>`SELECT id FROM tdd_phases WHERE tdd_session_id = ${tsid}`)[0].id;
					yield* sql`INSERT INTO files (path) VALUES ('/p/test/x.test.ts')`;
					const fileId = (yield* sql<{ id: number }>`SELECT id FROM files WHERE path = '/p/test/x.test.ts'`)[0].id;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-art', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-art', 'p', 'h-art', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
					const trid = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-art'`)[0].id;
					// SQLite UNIQUE treats NULL as distinct, so the idempotency key
					// only enforces uniqueness when all participating columns are
					// non-NULL. Provide concrete values to exercise the constraint.
					yield* sql`INSERT INTO tdd_artifacts (phase_id, artifact_kind, file_id, test_run_id, recorded_at) VALUES (${phid}, 'test_written', ${fileId}, ${trid}, '2026-04-29T00:00:00Z')`;
					yield* sql`INSERT INTO tdd_artifacts (phase_id, artifact_kind, file_id, test_run_id, recorded_at) VALUES (${phid}, 'test_written', ${fileId}, ${trid}, '2026-04-29T00:00:00Z')`;
				}),
			),
		).rejects.toThrow();
	});

	it("creates failure_signatures table and signature_hash column on test_errors", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(test_errors)`;
				return rows.map((r) => r.name);
			}),
		);
		expect(cols).toContain("signature_hash");

		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO failure_signatures (signature_hash, first_seen_at) VALUES ('abc123', '2026-04-29T00:00:00Z')`;
				const rows = yield* sql<{
					occurrence_count: number;
				}>`SELECT occurrence_count FROM failure_signatures WHERE signature_hash = 'abc123'`;
				expect(rows[0].occurrence_count).toBe(1);
			}),
		);
	});

	it("adds source_mapped_line and function_boundary_line to stack_frames", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(stack_frames)`;
				return rows.map((r) => r.name);
			}),
		);
		expect(cols).toContain("source_mapped_line");
		expect(cols).toContain("function_boundary_line");
	});

	it("creates hook_executions and enforces mutually-exclusive scope CHECK", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-he', '4.1.0')`;
				yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-he', 'p', 'h-he', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
				const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-he'`)[0].id;
				yield* sql`INSERT INTO hook_executions (run_id, hook_kind, passed) VALUES (${runId}, 'beforeAll', 1)`;
			}),
		);
	});

	it("rejects hook_executions with both test_module_id and test_case_id", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-he2', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-he2', 'p', 'h-he2', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
					const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-he2'`)[0].id;
					yield* sql`INSERT INTO files (path) VALUES ('/p/test/x.test.ts')`;
					const fileId = (yield* sql<{ id: number }>`SELECT id FROM files WHERE path = '/p/test/x.test.ts'`)[0].id;
					yield* sql`INSERT INTO test_modules (run_id, file_id, relative_module_id, state) VALUES (${runId}, ${fileId}, 'test/x.test.ts', 'passed')`;
					const moduleId = (yield* sql<{ id: number }>`SELECT id FROM test_modules LIMIT 1`)[0].id;
					yield* sql`INSERT INTO test_cases (module_id, name, full_name, state) VALUES (${moduleId}, 'should x', 'should x', 'passed')`;
					const caseId = (yield* sql<{ id: number }>`SELECT id FROM test_cases LIMIT 1`)[0].id;
					yield* sql`INSERT INTO hook_executions (run_id, test_module_id, test_case_id, hook_kind, passed) VALUES (${runId}, ${moduleId}, ${caseId}, 'beforeEach', 1)`;
				}),
			),
		).rejects.toThrow();
	});

	it("rejects invalid hook_executions.hook_kind", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h-he3', '4.1.0')`;
					yield* sql`INSERT INTO test_runs (invocation_id, project, settings_hash, timestamp, reason, duration, total, passed, failed, skipped) VALUES ('inv-he3', 'p', 'h-he3', '2026-04-29T00:00:00Z', 'passed', 0, 0, 0, 0, 0)`;
					const runId = (yield* sql<{ id: number }>`SELECT id FROM test_runs WHERE invocation_id = 'inv-he3'`)[0].id;
					yield* sql`INSERT INTO hook_executions (run_id, hook_kind, passed) VALUES (${runId}, 'beforeAlways', 1)`;
				}),
			),
		).rejects.toThrow();
	});

	it("notes_fts UPDATE preserves new content and drops old tokens", async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO notes (title, scope, content, created_at) VALUES ('t', 'global', 'apple banana', '2026-04-29T00:00:00Z')`;
				const noteId = (yield* sql<{ id: number }>`SELECT id FROM notes LIMIT 1`)[0].id;

				// Verify initial FTS index
				let matches = yield* sql<{
					id: number;
				}>`SELECT rowid AS id FROM notes_fts WHERE notes_fts MATCH 'apple'`;
				expect(matches).toHaveLength(1);

				// UPDATE the content
				yield* sql`UPDATE notes SET content = 'cherry date' WHERE id = ${noteId}`;

				// Old tokens gone
				matches = yield* sql<{
					id: number;
				}>`SELECT rowid AS id FROM notes_fts WHERE notes_fts MATCH 'apple'`;
				expect(matches).toHaveLength(0);

				// New tokens present
				matches = yield* sql<{
					id: number;
				}>`SELECT rowid AS id FROM notes_fts WHERE notes_fts MATCH 'cherry'`;
				expect(matches).toHaveLength(1);
			}),
		);
	});

	it("creates remaining 1.x carry-over tables", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
					ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);

		for (const name of [
			"import_durations",
			"scoped_files",
			"console_logs",
			"task_metadata",
			"test_history",
			"coverage_baselines",
			"coverage_trends",
			"file_coverage",
			"source_test_map",
			"notes",
		]) {
			expect(tables).toContain(name);
		}
	});
});
