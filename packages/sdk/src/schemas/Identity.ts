import { Schema } from "effect";

/**
 * Canonical UUID for an LLM agent invocation. Generated server-side at
 * `register_agent` time. Stable across transport reconnects within an
 * agent's lifetime.
 * @public
 */
export const AgentId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AgentId"));
/** @public */
export type AgentId = Schema.Schema.Type<typeof AgentId>;

/**
 * The unit "all work on this feature" rolls up to. Survives
 * `claude --resume` and parallel windows; lives in the host's
 * transcript filename for Claude Code.
 * @public
 */
export const ConversationId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ConversationId"));
/** @public */
export type ConversationId = Schema.Schema.Type<typeof ConversationId>;

/**
 * The agent host process's chat id (Claude Code's per-process chat
 * UUID, etc.). Shorter-lived than a conversation; one conversation can
 * have multiple chats across `--resume` invocations. Distinct from
 * `sessions.id` (the SQLite agent-run PK).
 * @public
 */
export const ChatId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ChatId"));
/** @public */
export type ChatId = Schema.Schema.Type<typeof ChatId>;

/**
 * One TDD orchestration task. Replaces the legacy `tdd_session_id`
 * vocabulary so "session" is unambiguous in the codebase.
 * @public
 */
export const TddTaskId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("TddTaskId"));
/** @public */
export type TddTaskId = Schema.Schema.Type<typeof TddTaskId>;

/**
 * Filesystem-safe key for the per-project data store directory under
 * `$XDG_DATA_HOME/vitest-agent/<projectKey>/`. Resolved by the
 * `ProjectIdentity` service from the explicit option / TOML config /
 * git remote / package.json fallback chain. Always non-empty (a missing
 * value is `ProjectIdentityNotResolvableError`, not an empty string).
 * @public
 */
export const ProjectKey = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("ProjectKey"));
/** @public */
export type ProjectKey = Schema.Schema.Type<typeof ProjectKey>;

/**
 * Who initiated the action (test run, hypothesis, note, TDD phase, …).
 * Recorded on every action row alongside `agent_id`.
 *
 * - `agent` — an LLM agent (`agent_id` is set, `conversation_id` is set)
 * - `user`  — a human at a terminal (`agent_id` and `conversation_id` are NULL)
 * - `system` — a CI run, scheduler, or other non-human/non-agent actor
 * @public
 */
export const ActorType = Schema.Literals(["agent", "user", "system"]).annotate({
	identifier: "ActorType",
});
/** @public */
export type ActorType = typeof ActorType.Type;

/**
 * Recommended canonical host identifiers. Open enum at the SDK level so
 * a new client doesn't require an SDK release; the MCP server defaults
 * `agentType` validation against the `${hostKind}-` prefix using this
 * value.
 *
 * `unknown` is the explicit fallback when `clientInfo.name` doesn't
 * match a known pattern — preferred over guessing.
 * @public
 */
export const HostKind = Schema.Literals([
	"claude-code",
	"claude-desktop",
	"cursor",
	"goose",
	"chatgpt",
	"mcp-inspector",
	"unknown",
]).annotate({ identifier: "HostKind" });
/** @public */
export type HostKind = typeof HostKind.Type;
