import { Data } from "effect";
import type { AgentId, ChatId, ConversationId } from "../schemas/Identity.js";

/**
 * `agent_id` does not exist for the given chat. Surface to the
 * caller; the typical resolution is to call `register_agent` for
 * this agent first.
 * @public
 */
export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
	readonly agentId: AgentId;
	readonly chatId?: ChatId;
}> {}

/**
 * Session row for the given `chat_id` does not exist. The host
 * probably hasn't fired the SessionStart equivalent for this chat yet.
 * @public
 */
export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
	readonly chatId: ChatId;
}> {}

/**
 * `conversation_id` does not exist. Used by rollup queries that
 * require a conversation row.
 * @public
 */
export class ConversationNotFoundError extends Data.TaggedError("ConversationNotFoundError")<{
	readonly conversationId: ConversationId;
}> {}

/**
 * True conflict — e.g., the `parentAgentId` supplied to
 * `register_agent` refers to a different session than the one the
 * caller named. Distinct from `IdempotencyHit`, which is a success.
 * @public
 */
export class RegistrationConflictError extends Data.TaggedError("RegistrationConflictError")<{
	readonly reason: string;
}> {
	constructor(args: { readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[register_agent] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/**
 * `host_metadata` JSON column failed to parse on read. Usually mapped
 * to `DataStoreError` at the row-read boundary; surfaces alone in
 * paths that explicitly carry through `Schema.parseJson` errors.
 * @public
 */
export class HostMetadataParseError extends Data.TaggedError("HostMetadataParseError")<{
	readonly raw: string;
	readonly reason: string;
}> {}

/**
 * Sidecar exceeded its timeout. Surfaces from the sidecar CLI's
 * `Effect.timeout`; the top-level wrapper maps it to exit code 2.
 * @public
 */
export class SidecarTimeoutError extends Data.TaggedError("SidecarTimeoutError")<{
	readonly operation: string;
	readonly timeoutMs: number;
}> {
	constructor(args: { readonly operation: string; readonly timeoutMs: number }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[sidecar ${args.operation}] timed out after ${args.timeoutMs}ms`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}
