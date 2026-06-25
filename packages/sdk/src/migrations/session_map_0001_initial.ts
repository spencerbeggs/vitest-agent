/**
 * Migration for the per-client session map SQLite at
 * `${CLAUDE_PLUGIN_DATA}/sessions.db` (Claude Code) or the
 * client-specific equivalent.
 *
 * The session map is a host-specific side-channel that translates
 * client-native identifiers (transcript path, hook-payload session id)
 * into the canonical UUIDs the per-project `data.db` expects. It lets
 * `claude --resume` reuse the same `conversation_id` UUID across
 * restarts.
 *
 * Two STRICT tables:
 *   - `conversation_map` keyed on the transcript filename UUID
 *     (already a UUID per Claude Code's convention)
 *   - `session_map` keyed on the host's native session id (the chat
 *     UUID — `session_id` from the Claude Code hook payload, exposed
 *     to agents as `chatId` post the 2026-05 rename)
 *
 * Concurrent writers from multiple Claude Code windows converge via
 * idempotent UPSERTs on the native-id keys; WAL mode plus 5s
 * busy_timeout absorb contention.
 * @public
 */

import { SqlClient } from "@effect/sql/SqlClient";
import { Effect } from "effect";

/** @internal */
const migration = Effect.gen(function* () {
	const sql = yield* SqlClient;

	yield* sql`PRAGMA journal_mode=WAL`;
	yield* sql`PRAGMA foreign_keys=ON`;
	yield* sql`PRAGMA busy_timeout=5000`;

	yield* sql`
		CREATE TABLE conversation_map (
			transcript_uuid  TEXT PRIMARY KEY,
			transcript_path  TEXT NOT NULL,
			conversation_id  TEXT NOT NULL UNIQUE,
			first_seen_at    INTEGER NOT NULL,
			last_seen_at     INTEGER NOT NULL
		) STRICT
	`;

	yield* sql`
		CREATE TABLE session_map (
			host_session_id  TEXT PRIMARY KEY,
			conversation_id  TEXT NOT NULL REFERENCES conversation_map(conversation_id) ON DELETE RESTRICT,
			project_key      TEXT NOT NULL,
			project_dir      TEXT NOT NULL,
			main_agent_id    TEXT NOT NULL,
			started_at       INTEGER NOT NULL,
			ended_at         INTEGER
		) STRICT
	`;
	yield* sql`CREATE INDEX idx_session_map_project_key ON session_map(project_key)`;
	yield* sql`CREATE INDEX idx_session_map_project_dir ON session_map(project_dir)`;
	yield* sql`CREATE INDEX idx_session_map_active ON session_map(project_dir) WHERE ended_at IS NULL`;
	yield* sql`CREATE INDEX idx_session_map_conversation_id ON session_map(conversation_id)`;
});
/** @public */
export default migration;
