import { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Layer } from "effect";
import { DataStoreError, extractSqlReason } from "../errors/DataStoreError.js";
import type { KnownProject, KnownProjectInput } from "../services/DiscoveryRegistry.js";
import { DiscoveryRegistry } from "../services/DiscoveryRegistry.js";

const TABLE = "known_projects";

interface KnownProjectRow {
	readonly project_key: string;
	readonly canonical_form: string;
	readonly data_db_path: string;
	readonly git_remote_origin: string | null;
	readonly workspace_root: string;
	readonly first_seen_at: number;
	readonly last_seen_at: number;
}

const rowToDomain = (row: KnownProjectRow): KnownProject => ({
	projectKey: row.project_key,
	canonicalForm: row.canonical_form,
	dataDbPath: row.data_db_path,
	gitRemoteOrigin: row.git_remote_origin,
	workspaceRoot: row.workspace_root,
	firstSeenAt: row.first_seen_at,
	lastSeenAt: row.last_seen_at,
});

const dayInMs = 60 * 60 * 24 * 1000;
/** @public */
export const DiscoveryRegistryLive: Layer.Layer<DiscoveryRegistry, never, SqlClient> = Layer.effect(
	DiscoveryRegistry,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		return {
			recordProject: (input: KnownProjectInput) =>
				Effect.gen(function* () {
					const now = Date.now();
					yield* sql`
						INSERT INTO ${sql(TABLE)} (
							project_key, canonical_form, data_db_path, git_remote_origin, workspace_root,
							first_seen_at, last_seen_at
						) VALUES (
							${input.projectKey}, ${input.canonicalForm}, ${input.dataDbPath},
							${input.gitRemoteOrigin}, ${input.workspaceRoot}, ${now}, ${now}
						)
						ON CONFLICT(project_key) DO UPDATE SET
							canonical_form    = excluded.canonical_form,
							data_db_path      = excluded.data_db_path,
							git_remote_origin = excluded.git_remote_origin,
							workspace_root    = excluded.workspace_root,
							last_seen_at      = excluded.last_seen_at
					`;
				}).pipe(
					Effect.mapError((e) => new DataStoreError({ operation: "write", table: TABLE, reason: extractSqlReason(e) })),
				),
			listProjects: () =>
				Effect.gen(function* () {
					const rows = yield* sql<KnownProjectRow>`
						SELECT project_key, canonical_form, data_db_path, git_remote_origin, workspace_root,
							first_seen_at, last_seen_at
						FROM ${sql(TABLE)}
						ORDER BY last_seen_at DESC, rowid DESC
					`;
					return rows.map(rowToDomain);
				}).pipe(
					Effect.mapError((e) => new DataStoreError({ operation: "read", table: TABLE, reason: extractSqlReason(e) })),
				),
			prune: (maxAgeDays: number) =>
				Effect.gen(function* () {
					const cutoff = Date.now() - maxAgeDays * dayInMs;
					const before = yield* sql<{
						c: number;
					}>`SELECT COUNT(*) AS c FROM ${sql(TABLE)} WHERE last_seen_at < ${cutoff}`;
					const removable = before[0]?.c ?? 0;
					if (removable > 0) {
						yield* sql`DELETE FROM ${sql(TABLE)} WHERE last_seen_at < ${cutoff}`;
					}
					return removable;
				}).pipe(
					Effect.mapError((e) => new DataStoreError({ operation: "write", table: TABLE, reason: extractSqlReason(e) })),
				),
		};
	}),
);
