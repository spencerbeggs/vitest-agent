/**
 * Per-client session map service tags.
 *
 * The map is a host-specific side-channel that translates the host's
 * native identifiers (transcript UUID, hook-payload session id) into
 * the canonical UUIDs the per-project data store expects. Multiple
 * Claude Code windows write to a single SQLite file at
 * `${CLAUDE_PLUGIN_DATA}/sessions.db`; WAL mode plus idempotent
 * upserts on native-id keys keep them coherent without app-level
 * locking.
 *
 * The Reader / Writer split is a typed-error guarantee. The MCP
 * server opens the SQLite file with `?mode=ro` and depends only on
 * the `Reader` tag. The sidecar opens read-write and provides both
 * tags. Compile-time check: an MCP code path that calls a write
 * method is a type error rather than a runtime
 * `ReadOnlyDatabaseError` throw.
 *
 * @packageDocumentation
 */

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { DataStoreError } from "../errors/DataStoreError.js";

export interface MapSessionInput {
	readonly hostSessionId: string;
	readonly conversationId: string;
	readonly projectKey: string;
	readonly projectDir: string;
}

export interface MapSessionOutput {
	readonly mainAgentId: string;
	readonly conversationId: string;
}

export interface SessionContextRow {
	readonly hostSessionId: string;
	readonly conversationId: string;
	readonly projectKey: string;
	readonly projectDir: string;
	readonly mainAgentId: string;
	readonly startedAt: number;
	readonly endedAt: number | null;
}

/**
 * Read-only side of the session map.
 *
 * Provided by `PerClientSessionMapReaderLive` (opens SQLite with
 * `?mode=ro`). MCP server depends on this tag — calls to write
 * methods would be a type error.
 */
export class PerClientSessionMapReader extends Context.Tag("vitest-agent/PerClientSessionMapReader")<
	PerClientSessionMapReader,
	{
		/**
		 * Look up an existing conversation_id for a given transcript
		 * path. Returns `Option.none()` when the transcript hasn't been
		 * seen before. Read-only — does not insert.
		 */
		readonly lookupConversation: (transcriptPath: string) => Effect.Effect<Option.Option<string>, DataStoreError>;
		/**
		 * Return the most recent open session for a project_dir
		 * (`ended_at IS NULL`). The MCP server uses this to recover
		 * `currentSessionContext` after `/reload-plugins`. The compound
		 * index `idx_session_map_active` covers the predicate.
		 */
		readonly lookupByProjectDir: (
			projectDir: string,
		) => Effect.Effect<Option.Option<SessionContextRow>, DataStoreError>;
	}
>() {}

/**
 * Read-write side of the session map. Sidecar provides this; the
 * Writer layer also satisfies the Reader tag so consumers of either
 * one resolve.
 */
export class PerClientSessionMapWriter extends Context.Tag("vitest-agent/PerClientSessionMapWriter")<
	PerClientSessionMapWriter,
	{
		/**
		 * Upsert a conversation row. Returns the canonical conversation_id
		 * for the given transcript_path (existing if seen before, freshly
		 * generated otherwise).
		 */
		readonly mapConversation: (transcriptPath: string) => Effect.Effect<string, DataStoreError>;
		/**
		 * Upsert a session row. Returns the canonical main_agent_id and
		 * conversation_id (existing if `host_session_id` was seen before,
		 * freshly generated otherwise).
		 *
		 * The caller is responsible for having already mapped the
		 * conversation; this method only records the
		 * (host_session_id, conversation_id, project) tuple.
		 */
		readonly mapSession: (input: MapSessionInput) => Effect.Effect<MapSessionOutput, DataStoreError>;
		/**
		 * Mark a session as ended. Sets `ended_at` to the supplied
		 * timestamp. No-op if the session is unknown — endSession is
		 * best-effort cleanup.
		 */
		readonly endSession: (hostSessionId: string, endedAt: number) => Effect.Effect<void, DataStoreError>;
		/**
		 * Read methods so the Writer also satisfies the Reader tag's
		 * surface.
		 */
		readonly lookupConversation: (transcriptPath: string) => Effect.Effect<Option.Option<string>, DataStoreError>;
		readonly lookupByProjectDir: (
			projectDir: string,
		) => Effect.Effect<Option.Option<SessionContextRow>, DataStoreError>;
	}
>() {}
