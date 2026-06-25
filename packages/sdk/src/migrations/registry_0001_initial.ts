import { SqlClient } from "@effect/sql/SqlClient";
import { Effect } from "effect";

/**
 * Migration for the global discovery registry SQLite at
 * `$XDG_DATA_HOME/vitest-agent/registry.db`.
 *
 * Single table `known_projects` indexed by `project_key` (the
 * filesystem-safe form from {@link ProjectIdentity}). Tooling like
 * `mcp-app` queries this table to enumerate every vitest-agent
 * project the user has ever run on this machine.
 *
 * The registry never blocks anything — its writes are best-effort.
 * Concurrent writers from multiple Claude Code windows converge via
 * the `ON CONFLICT(project_key) DO UPDATE` upsert.
 * @public
 */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	yield* sql`PRAGMA journal_mode=WAL`;
	yield* sql`PRAGMA foreign_keys=ON`;
	yield* sql`PRAGMA busy_timeout=5000`;

	yield* sql`
		CREATE TABLE known_projects (
			project_key       TEXT PRIMARY KEY,
			canonical_form    TEXT NOT NULL,
			data_db_path      TEXT NOT NULL,
			git_remote_origin TEXT,
			workspace_root    TEXT NOT NULL,
			first_seen_at     INTEGER NOT NULL,
			last_seen_at      INTEGER NOT NULL
		) STRICT
	`;
	yield* sql`CREATE INDEX idx_known_projects_workspace_root ON known_projects(workspace_root)`;
});

export default migration;
