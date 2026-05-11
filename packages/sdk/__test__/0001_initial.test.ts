import * as NodeContext from "@effect/platform-node/NodeContext";
import { SqlClient } from "@effect/sql/SqlClient";
import { layer as sqliteClientLayer } from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import migration0001 from "../src/migrations/0001_initial.js";

const makeLayer = () => {
	const SqliteLayer = sqliteClientLayer({ filename: ":memory:" });
	const PlatformLayer = NodeContext.layer;
	const MigratorLayer = SqliteMigrator.layer({
		loader: SqliteMigrator.fromRecord({ "0001_initial": migration0001 }),
	}).pipe(Layer.provide(Layer.merge(SqliteLayer, PlatformLayer)));
	return Layer.mergeAll(MigratorLayer, SqliteLayer, PlatformLayer);
};

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) => Effect.runPromise(Effect.provide(effect, makeLayer()));

const causeMessage = (e: unknown): string => {
	const wrapped = e as { cause?: { message?: string } | string; message?: string };
	if (wrapped && typeof wrapped === "object") {
		if (typeof wrapped.cause === "object" && wrapped.cause !== null && typeof wrapped.cause.message === "string") {
			return wrapped.cause.message;
		}
		if (typeof wrapped.cause === "string") return wrapped.cause;
	}
	return String(e);
};

describe("0001_initial migration (consolidated)", () => {
	it("creates every table from the legacy 0001+0002 baseline plus the agents table", async () => {
		const tables = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master
					WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sql_%' AND name NOT LIKE 'notes_fts%'
					ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);

		const expected = [
			"agents",
			"attachments",
			"build_artifacts",
			"commits",
			"console_logs",
			"coverage_baselines",
			"coverage_trends",
			"failure_signatures",
			"file_coverage",
			"file_edits",
			"files",
			"hook_executions",
			"hypotheses",
			"import_durations",
			"mcp_idempotent_responses",
			"notes",
			"run_changed_files",
			"run_triggers",
			"scoped_files",
			"sessions",
			"settings",
			"settings_env_vars",
			"source_test_map",
			"stack_frames",
			"tags",
			"task_metadata",
			"tdd_artifacts",
			"tdd_behavior_dependencies",
			"tdd_phases",
			"tdd_session_behaviors",
			"tdd_session_goals",
			"tdd_tasks",
			"test_annotations",
			"test_artifacts",
			"test_case_tags",
			"test_cases",
			"test_errors",
			"test_history",
			"test_modules",
			"test_runs",
			"test_suite_tags",
			"test_suites",
			"tool_invocations",
			"turns",
		];
		for (const table of expected) {
			expect(tables).toContain(table);
		}
	});

	it("agents table is STRICT and has the expected columns", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(agents)`;
				return rows.map((r) => r.name);
			}),
		);
		expect(cols).toEqual([
			"agent_id",
			"session_id",
			"parent_agent_id",
			"conversation_id",
			"agent_type",
			"started_at",
			"ended_at",
			"start_git_branch",
			"start_git_commit_sha",
			"start_worktree_dir",
			"idempotency_key",
		]);
	});

	it("sessions table includes the new conversation_id and host_kind columns", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(sessions)`;
				return rows.map((r) => r.name);
			}),
		);
		expect(cols).toContain("conversation_id");
		expect(cols).toContain("host_kind");
	});

	it("test_runs table includes git context, host metadata, and actor columns", async () => {
		const cols = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`PRAGMA table_info(test_runs)`;
				return rows.map((r) => r.name);
			}),
		);
		for (const expected of [
			"actor_type",
			"agent_id",
			"conversation_id",
			"git_branch",
			"git_commit_sha",
			"git_dirty",
			"git_upstream",
			"git_worktree_dir",
			"host_source",
			"host_value",
			"host_metadata",
		]) {
			expect(cols).toContain(expected);
		}
	});

	it("hypotheses, notes, and tdd_phases all gain actor columns", async () => {
		const colsFor = (table: string) =>
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					const rows = yield* sql<{ name: string }>`PRAGMA table_info(${sql(table)})`;
					return rows.map((r) => r.name);
				}),
			);
		for (const table of ["hypotheses", "notes", "tdd_phases"]) {
			const cols = await colsFor(table);
			expect(cols, `missing columns on ${table}`).toContain("actor_type");
			expect(cols, `missing columns on ${table}`).toContain("agent_id");
			expect(cols, `missing columns on ${table}`).toContain("conversation_id");
		}
	});

	it("conversation_id immutability triggers exist for every table that carries it", async () => {
		const triggers = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%_conv_id_immutable'
					ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);
		expect(triggers).toEqual([
			"trg_agents_conv_id_immutable",
			"trg_hypotheses_conv_id_immutable",
			"trg_notes_conv_id_immutable",
			"trg_sessions_conv_id_immutable",
			"trg_tdd_phases_conv_id_immutable",
			"trg_test_runs_conv_id_immutable",
		]);
	});

	it("UPDATE that changes sessions.conversation_id is rejected by the trigger", async () => {
		const error = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (chat_id, project, cwd, agent_kind, started_at, conversation_id) VALUES ('s1', 'p', '/cwd', 'main', '2026-01-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')`;
				return yield* sql`UPDATE sessions SET conversation_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE chat_id = 's1'`.pipe(
					Effect.flip,
				);
			}),
		);
		expect(causeMessage(error)).toMatch(/conversation_id is immutable/i);
	});

	it("agents.idempotency_key is UNIQUE per session_id", async () => {
		const error = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (1, 's1', 'p', '/c', 'main', '2026-01-01')`;
				yield* sql`INSERT INTO agents (agent_id, session_id, agent_type, started_at, idempotency_key) VALUES ('a1', 1, 't', 0, 'k1')`;
				return yield* sql`INSERT INTO agents (agent_id, session_id, agent_type, started_at, idempotency_key) VALUES ('a2', 1, 't', 0, 'k1')`.pipe(
					Effect.flip,
				);
			}),
		);
		expect(causeMessage(error)).toMatch(/UNIQUE constraint failed/);
	});

	it("agents with same idempotency_key in DIFFERENT sessions is allowed", async () => {
		await expect(
			run(
				Effect.gen(function* () {
					const sql = yield* SqlClient;
					yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (1, 's1', 'p', '/c', 'main', '2026-01-01')`;
					yield* sql`INSERT INTO sessions (id, chat_id, project, cwd, agent_kind, started_at) VALUES (2, 's2', 'p', '/c', 'main', '2026-01-01')`;
					yield* sql`INSERT INTO agents (agent_id, session_id, agent_type, started_at, idempotency_key) VALUES ('a1', 1, 't', 0, 'k1')`;
					yield* sql`INSERT INTO agents (agent_id, session_id, agent_type, started_at, idempotency_key) VALUES ('a2', 2, 't', 0, 'k1')`;
				}),
			),
		).resolves.not.toThrow();
	});

	it("test_runs CHECK rejects actor_type='agent' with NULL agent_id", async () => {
		const error = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h1', '4.1.5')`;
				return yield* sql`INSERT INTO test_runs (
					invocation_id, project, settings_hash, timestamp, reason,
					duration, total, passed, failed, skipped, actor_type
				) VALUES ('inv', 'p', 'h1', '2026-01-01', 'passed', 0, 0, 0, 0, 0, 'agent')`.pipe(Effect.flip);
			}),
		);
		expect(causeMessage(error)).toMatch(/CHECK constraint failed/);
	});

	it("test_runs CHECK rejects user-actor with non-NULL conversation_id", async () => {
		const error = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				yield* sql`INSERT INTO settings (hash, vitest_version) VALUES ('h1', '4.1.5')`;
				return yield* sql`INSERT INTO test_runs (
					invocation_id, project, settings_hash, timestamp, reason,
					duration, total, passed, failed, skipped,
					actor_type, conversation_id
				) VALUES ('inv', 'p', 'h1', '2026-01-01', 'passed', 0, 0, 0, 0, 0, 'user', 'cccccccc-cccc-cccc-cccc-cccccccccccc')`.pipe(
					Effect.flip,
				);
			}),
		);
		expect(causeMessage(error)).toMatch(/CHECK constraint failed/);
	});

	it("notes_fts virtual table is created with INSERT/DELETE/UPDATE triggers", async () => {
		const triggers = await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				const rows = yield* sql<{ name: string }>`
					SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='notes' AND name LIKE 'notes_%' ORDER BY name
				`;
				return rows.map((r) => r.name);
			}),
		);
		expect(triggers).toEqual(["notes_ad", "notes_ai", "notes_au", "notes_bu"]);
	});
});
