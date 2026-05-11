/**
 * Live and Test layers for {@link PerClientSessionMapReader} and
 * {@link PerClientSessionMapWriter}.
 *
 * Both layers consume an existing `SqlClient` provided by the entry
 * point. The entry point chooses read-only vs read-write SQLite mode
 * by configuring the `SqlClient` it provides — the layers themselves
 * don't open the connection.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Layer, Option } from "effect";
import { DataStoreError, extractSqlReason } from "../errors/DataStoreError.js";
import type { MapSessionInput, MapSessionOutput, SessionContextRow } from "../services/PerClientSessionMap.js";
import { PerClientSessionMapReader, PerClientSessionMapWriter } from "../services/PerClientSessionMap.js";

interface ConversationRow {
	readonly transcript_uuid: string;
	readonly transcript_path: string;
	readonly conversation_id: string;
	readonly first_seen_at: number;
	readonly last_seen_at: number;
}

interface SessionRow {
	readonly host_session_id: string;
	readonly conversation_id: string;
	readonly project_key: string;
	readonly project_dir: string;
	readonly main_agent_id: string;
	readonly started_at: number;
	readonly ended_at: number | null;
}

const sessionRowToContext = (row: SessionRow): SessionContextRow => ({
	hostSessionId: row.host_session_id,
	conversationId: row.conversation_id,
	projectKey: row.project_key,
	projectDir: row.project_dir,
	mainAgentId: row.main_agent_id,
	startedAt: row.started_at,
	endedAt: row.ended_at,
});

/**
 * Extract the transcript UUID from a transcript file path. Claude
 * Code's transcript filenames are the conversation UUID directly
 * (with optional `.jsonl` suffix), so the basename is the right
 * stable key — path normalization differences (symlinks, user
 * renames) don't fragment the table.
 */
const extractTranscriptUuid = (transcriptPath: string): string => {
	const base = basename(transcriptPath);
	const dotIndex = base.lastIndexOf(".");
	return dotIndex === -1 ? base : base.slice(0, dotIndex);
};

const lookupConversationImpl = (sql: SqlClient, transcriptPath: string) =>
	Effect.gen(function* () {
		const uuid = extractTranscriptUuid(transcriptPath);
		const rows = yield* sql<ConversationRow>`
			SELECT transcript_uuid, transcript_path, conversation_id, first_seen_at, last_seen_at
			FROM conversation_map WHERE transcript_uuid = ${uuid}
		`;
		return rows.length === 0 ? Option.none<string>() : Option.some(rows[0].conversation_id);
	}).pipe(
		Effect.mapError(
			(e) => new DataStoreError({ operation: "read", table: "conversation_map", reason: extractSqlReason(e) }),
		),
	);

const lookupByProjectDirImpl = (sql: SqlClient, projectDir: string) =>
	Effect.gen(function* () {
		const rows = yield* sql<SessionRow>`
			SELECT host_session_id, conversation_id, project_key, project_dir, main_agent_id, started_at, ended_at
			FROM session_map
			WHERE project_dir = ${projectDir} AND ended_at IS NULL
			ORDER BY started_at DESC
			LIMIT 1
		`;
		return rows.length === 0 ? Option.none<SessionContextRow>() : Option.some(sessionRowToContext(rows[0]));
	}).pipe(
		Effect.mapError(
			(e) => new DataStoreError({ operation: "read", table: "session_map", reason: extractSqlReason(e) }),
		),
	);

/**
 * Read-only layer. The entry point provides an `SqlClient` configured
 * with the `?mode=ro` URI parameter; this layer wraps the read
 * methods and never declares write methods.
 */
export const PerClientSessionMapReaderLive: Layer.Layer<PerClientSessionMapReader, never, SqlClient> = Layer.effect(
	PerClientSessionMapReader,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		return {
			lookupConversation: (path) => lookupConversationImpl(sql, path),
			lookupByProjectDir: (dir) => lookupByProjectDirImpl(sql, dir),
		};
	}),
);

/**
 * Read-write layer. Provides both write methods and the Reader's read
 * methods so the same layer instance satisfies callers of either
 * tag.
 */
export const PerClientSessionMapWriterLive: Layer.Layer<
	PerClientSessionMapWriter | PerClientSessionMapReader,
	never,
	SqlClient
> = Layer.effect(
	PerClientSessionMapWriter,
	Effect.gen(function* () {
		const sql = yield* SqlClient;

		const mapConversation = (transcriptPath: string) =>
			Effect.gen(function* () {
				const uuid = extractTranscriptUuid(transcriptPath);
				const existing = yield* sql<ConversationRow>`
					SELECT conversation_id FROM conversation_map WHERE transcript_uuid = ${uuid}
				`;
				const now = Date.now();
				if (existing.length > 0) {
					yield* sql`UPDATE conversation_map SET last_seen_at = ${now} WHERE transcript_uuid = ${uuid}`;
					return existing[0].conversation_id;
				}
				const conversationId = randomUUID();
				yield* sql`
					INSERT INTO conversation_map (transcript_uuid, transcript_path, conversation_id, first_seen_at, last_seen_at)
					VALUES (${uuid}, ${transcriptPath}, ${conversationId}, ${now}, ${now})
				`;
				return conversationId;
			}).pipe(
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "conversation_map", reason: extractSqlReason(e) }),
				),
			);

		const mapSession = (input: MapSessionInput): Effect.Effect<MapSessionOutput, DataStoreError> =>
			Effect.gen(function* () {
				const existing = yield* sql<{ main_agent_id: string; conversation_id: string }>`
					SELECT main_agent_id, conversation_id FROM session_map WHERE host_session_id = ${input.hostSessionId}
				`;
				if (existing.length > 0) {
					return {
						mainAgentId: existing[0].main_agent_id,
						conversationId: existing[0].conversation_id,
					};
				}
				const mainAgentId = randomUUID();
				const now = Date.now();
				yield* sql`
					INSERT INTO session_map (
						host_session_id, conversation_id, project_key, project_dir, main_agent_id, started_at, ended_at
					) VALUES (
						${input.hostSessionId}, ${input.conversationId}, ${input.projectKey}, ${input.projectDir},
						${mainAgentId}, ${now}, ${null}
					)
				`;
				return { mainAgentId, conversationId: input.conversationId };
			}).pipe(
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "session_map", reason: extractSqlReason(e) }),
				),
			);

		const endSession = (hostSessionId: string, endedAt: number) =>
			sql`UPDATE session_map SET ended_at = ${endedAt} WHERE host_session_id = ${hostSessionId}`.pipe(
				Effect.asVoid,
				Effect.mapError(
					(e) => new DataStoreError({ operation: "write", table: "session_map", reason: extractSqlReason(e) }),
				),
			);

		return {
			mapConversation,
			mapSession,
			endSession,
			lookupConversation: (path) => lookupConversationImpl(sql, path),
			lookupByProjectDir: (dir) => lookupByProjectDirImpl(sql, dir),
		};
	}),
).pipe(
	Layer.provideMerge(
		Layer.effect(
			PerClientSessionMapReader,
			Effect.gen(function* () {
				const sql = yield* SqlClient;
				return {
					lookupConversation: (path) => lookupConversationImpl(sql, path),
					lookupByProjectDir: (dir) => lookupByProjectDirImpl(sql, dir),
				};
			}),
		),
	),
);
