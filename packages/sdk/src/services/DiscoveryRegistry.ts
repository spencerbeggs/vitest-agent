import type { Effect } from "effect";
import { Context } from "effect";
import type { DataStoreError } from "../errors/DataStoreError.js";

/**
 * Input for upserting a known project into the global discovery registry.
 *
 * @public
 */
export interface KnownProjectInput {
	readonly projectKey: string;
	readonly canonicalForm: string;
	readonly dataDbPath: string;
	readonly gitRemoteOrigin: string | null;
	readonly workspaceRoot: string;
}

/**
 * A project record as stored in the global discovery registry.
 *
 * @public
 */
export interface KnownProject {
	readonly projectKey: string;
	readonly canonicalForm: string;
	readonly dataDbPath: string;
	readonly gitRemoteOrigin: string | null;
	readonly workspaceRoot: string;
	readonly firstSeenAt: number;
	readonly lastSeenAt: number;
}
/** @public */
export class DiscoveryRegistry extends Context.Tag("vitest-agent/DiscoveryRegistry")<
	DiscoveryRegistry,
	{
		/**
		 * Upsert this project into the registry. Sets `first_seen_at` on
		 * insert; updates `last_seen_at` plus all mutable fields on
		 * conflict. Returns nothing — the call is fire-and-observe.
		 */
		readonly recordProject: (input: KnownProjectInput) => Effect.Effect<void, DataStoreError>;
		/**
		 * List all projects ordered by most recent activity first. Used by
		 * cross-project discovery tooling.
		 */
		readonly listProjects: () => Effect.Effect<ReadonlyArray<KnownProject>, DataStoreError>;
		/**
		 * Drop registry rows whose `last_seen_at` is older than `maxAgeDays`
		 * days ago. The corresponding `data.db` files are NOT deleted; only
		 * the index entry is pruned. Returns the count of removed rows.
		 */
		readonly prune: (maxAgeDays: number) => Effect.Effect<number, DataStoreError>;
	}
>() {}
