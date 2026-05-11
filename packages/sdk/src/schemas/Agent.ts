/**
 * Agent invocation record + supporting result types.
 *
 * One row per agent run, with a `parentAgentId` pointer for subagent
 * trees of arbitrary depth. The `idempotencyKey` is set by every
 * caller (sidecar / MCP / future client) via
 * {@link deriveIdempotencyKey} so a hook retry collapses to the same
 * row instead of creating a duplicate.
 *
 * `Agent` is a `Schema.TaggedClass` — the `_tag` discriminator lets
 * `Match.tag` symmetrically dispatch on the {@link RegisterAgentResult}
 * union (`Agent` vs `IdempotencyHit`) without losing typed-error
 * guarantees.
 *
 * @packageDocumentation
 */

import { Data, Schema } from "effect";
import { AgentId, ConversationId } from "./Identity.js";

/**
 * Successful registration row. The fields mirror the `agents` SQLite
 * table 1:1 in camelCase.
 *
 * `startGitBranch`, `startGitCommitSha`, `startWorktreeDir` capture
 * *what the agent inherited at registration time* — distinct from the
 * per-run git context recorded on `runs`. A divergence between the
 * two reveals a mid-session branch switch, which is itself signal.
 */
export class Agent extends Schema.TaggedClass<Agent>()("Agent", {
	agentId: AgentId,
	// FK to `sessions.id` (integer PK in the current schema). The
	// `ChatId` UUID brand from `./Identity.js` describes the host's
	// chat UUID concept (`chat_id` column) — distinct from the
	// internal SQLite FK used here. The agent-agnostic-taxonomy plan
	// folds these together once `sessions.id` becomes the host UUID
	// directly; until then, this stays a number.
	sessionId: Schema.Number,
	parentAgentId: Schema.NullOr(AgentId),
	conversationId: Schema.NullOr(ConversationId),
	agentType: Schema.String,
	startedAt: Schema.Number,
	endedAt: Schema.NullOr(Schema.Number),
	startGitBranch: Schema.NullOr(Schema.String),
	startGitCommitSha: Schema.NullOr(Schema.String),
	startWorktreeDir: Schema.NullOr(Schema.String),
	idempotencyKey: Schema.String,
}) {}

/**
 * Returned by `DataStore.registerAgent` when the
 * `(session_id, idempotency_key)` UNIQUE constraint already has a
 * row. Not an error — the caller treats it as a successful recovery
 * of the existing `agentId`.
 *
 * Modeled as a `Data.TaggedClass` so the success channel of
 * `registerAgent` is `Effect<Agent | IdempotencyHit, ...>` and
 * downstream code uses `Match.tag` to branch.
 */
export class IdempotencyHit extends Data.TaggedClass("IdempotencyHit")<{
	readonly existingAgentId: typeof AgentId.Type;
}> {}

/**
 * Sum type of the two possible outcomes of `registerAgent`.
 */
export type RegisterAgentResult = Agent | IdempotencyHit;

/**
 * Agent tree — root agent with all descendants nested under
 * `children`. Returned by `DataStore.getAgentTree` for forensics and
 * the `vitest-agent agent list` CLI subcommand.
 */
export interface AgentTreeNode {
	readonly agent: Agent;
	readonly children: ReadonlyArray<AgentTreeNode>;
}
