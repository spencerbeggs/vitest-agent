/**
 * Identity brand schemas — the four-tier model from the agent-agnostic
 * taxonomy plan plus supporting literals.
 *
 * Each UUID-shaped ID builds on `Schema.UUID` (not a hand-rolled
 * `Schema.pattern`) so `JSONSchema.make` reliably emits
 * `{ type: "string", format: "uuid", pattern: <rfc-4122> }` at the MCP
 * wire boundary. Brand wrappers prevent passing one ID where another is
 * expected — the in-process types stay correct.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * Canonical UUID for an LLM agent invocation. Generated server-side at
 * `register_agent` time. Stable across transport reconnects within an
 * agent's lifetime.
 */
export const AgentId = Schema.UUID.pipe(Schema.brand("AgentId"));
export type AgentId = Schema.Schema.Type<typeof AgentId>;

/**
 * The unit "all work on this feature" rolls up to. Survives
 * `claude --resume` and parallel windows; lives in the host's
 * transcript filename for Claude Code.
 */
export const ConversationId = Schema.UUID.pipe(Schema.brand("ConversationId"));
export type ConversationId = Schema.Schema.Type<typeof ConversationId>;

/**
 * The agent host process's chat id (Claude Code's per-process chat
 * UUID, etc.). Shorter-lived than a conversation; one conversation can
 * have multiple chats across `--resume` invocations. Distinct from
 * `sessions.id` (the SQLite agent-run PK).
 */
export const ChatId = Schema.UUID.pipe(Schema.brand("ChatId"));
export type ChatId = Schema.Schema.Type<typeof ChatId>;

/**
 * One TDD orchestration task. Replaces the legacy `tdd_session_id`
 * vocabulary so "session" is unambiguous in the codebase.
 */
export const TddTaskId = Schema.UUID.pipe(Schema.brand("TddTaskId"));
export type TddTaskId = Schema.Schema.Type<typeof TddTaskId>;

/**
 * Filesystem-safe key for the per-project data store directory under
 * `$XDG_DATA_HOME/vitest-agent/<projectKey>/`. Resolved by the
 * `ProjectIdentity` service from the explicit option / TOML config /
 * git remote / package.json fallback chain. Always non-empty (a missing
 * value is `ProjectIdentityNotResolvableError`, not an empty string).
 */
export const ProjectKey = Schema.String.pipe(Schema.minLength(1), Schema.brand("ProjectKey"));
export type ProjectKey = Schema.Schema.Type<typeof ProjectKey>;

/**
 * Who initiated the action (test run, hypothesis, note, TDD phase, …).
 * Recorded on every action row alongside `agent_id`.
 *
 * - `agent` — an LLM agent (`agent_id` is set, `conversation_id` is set)
 * - `user`  — a human at a terminal (`agent_id` and `conversation_id` are NULL)
 * - `system` — a CI run, scheduler, or other non-human/non-agent actor
 */
export const ActorType = Schema.Literal("agent", "user", "system").annotations({
	identifier: "ActorType",
});
export type ActorType = typeof ActorType.Type;

/**
 * Recommended canonical host identifiers. Open enum at the SDK level so
 * a new client doesn't require an SDK release; the MCP server defaults
 * `agentType` validation against the `${hostKind}-` prefix using this
 * value.
 *
 * `unknown` is the explicit fallback when `clientInfo.name` doesn't
 * match a known pattern — preferred over guessing.
 */
export const HostKind = Schema.Literal(
	"claude-code",
	"claude-desktop",
	"cursor",
	"goose",
	"chatgpt",
	"mcp-inspector",
	"unknown",
).annotations({ identifier: "HostKind" });
export type HostKind = typeof HostKind.Type;
