/**
 * `register_agent` MCP tool.
 *
 * Idempotently inserts an `agents` row in the per-project store.
 * Cross-client by design: the input takes a generic `hostKind`
 * (default-resolved from `clientInfo.name` at the MCP boundary in a
 * follow-up; the tool itself defaults to `"claude-code"` for now)
 * and the canonical UUID-typed `chatId` / `conversationId` /
 * `parentAgentId` brands.
 *
 * Returns the resolved `agentId` on success or
 * `{ ok: false, error: { code, ...details } }` for the four
 * documented error codes:
 *
 *   - `AGENT_ALREADY_REGISTERED` — idempotency hit; carries
 *     `existingAgentId` so the caller proceeds with the recovered ID.
 *   - `PARENT_AGENT_NOT_FOUND` — `parentAgentId` references an agent
 *     not in the named session.
 *   - `SESSION_NOT_FOUND` — the integer FK could not be resolved
 *     from `chatId` (host has not called the SessionStart equivalent
 *     yet).
 *   - `INVALID_AGENT_TYPE_PREFIX` — `agentType` does not start with
 *     `${hostKind}-`.
 *
 * The success-with-info `IdempotencyHit` from the SDK collapses into
 * `AGENT_ALREADY_REGISTERED` here so MCP clients see one shape per
 * outcome.
 */

import { DataReader, DataStore, deriveIdempotencyKey } from "@vitest-agent/engine";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

/**
 * The `register_agent` tool's parameters.
 *
 * @public
 */
export const RegisterAgentInput = Schema.Struct({
	chatId: Schema.String.annotate({ description: "Host's chat UUID (session_id from CC hook payload, etc.)" }),
	conversationId: Schema.optionalKey(Schema.String).annotate({
		description: "Canonical conversation UUID (from session-map mapConversation)",
	}),
	hostKind: Schema.optionalKey(Schema.String).annotate({
		description: "Host vendor identifier; defaults to 'claude-code'",
	}),
	agentType: Schema.String.annotate({ description: "Agent type; must begin with the host-kind prefix" }),
	parentAgentId: Schema.optionalKey(Schema.String).annotate({
		description: "Parent agent UUID for subagent registrations",
	}),
	clientNonce: Schema.optionalKey(Schema.String).annotate({
		description:
			"Disambiguator for sibling-subagent registrations under the same parent; the server derives a deterministic default when omitted, which collapses parallel siblings into one row",
	}),
	startGitBranch: Schema.optionalKey(Schema.String),
	startGitCommitSha: Schema.optionalKey(Schema.String),
	startWorktreeDir: Schema.optionalKey(Schema.String),
});
/**
 * The decoded {@link RegisterAgentInput}.
 *
 * @public
 */
export type RegisterAgentInputType = Schema.Schema.Type<typeof RegisterAgentInput>;

const RegisterAgentSuccess = Schema.Struct({
	ok: Schema.Literal(true).annotate({
		description: "Discriminant — `true` when the agent row was inserted (or an existing one recovered).",
	}),
	agentId: Schema.String.annotate({
		title: "agents.agent_id",
		description: "Canonical UUID for the registered agent — pass to subsequent attribution-bearing calls.",
	}),
	conversationId: Schema.NullOr(Schema.String).annotate({
		description: "Conversation UUID from the host's transcript when one was supplied; `null` otherwise.",
	}),
	idempotencyKey: Schema.String.annotate({
		description:
			"26-char base32 SHA-256 of (agentType, parentAgentId|sentinel, clientNonce). Stable across retries with identical input.",
	}),
}).annotate({ identifier: "RegisterAgentSuccess" });

const RegisterAgentFailure = Schema.Struct({
	ok: Schema.Literal(false).annotate({ description: "Discriminant — `false` when registration was refused." }),
	error: Schema.Struct({
		code: Schema.Literals([
			"AGENT_ALREADY_REGISTERED",
			"PARENT_AGENT_NOT_FOUND",
			"SESSION_NOT_FOUND",
			"INVALID_AGENT_TYPE_PREFIX",
		]).annotate({
			description:
				"Refusal reason. AGENT_ALREADY_REGISTERED carries `existingAgentId` so the caller can recover. INVALID_AGENT_TYPE_PREFIX carries `expectedPrefix`.",
		}),
		message: Schema.String.annotate({ description: "Human-readable refusal explanation." }),
		existingAgentId: Schema.optional(Schema.String).annotate({
			description: "Present only when `code = AGENT_ALREADY_REGISTERED`. Use this id instead of registering a new one.",
		}),
		expectedPrefix: Schema.optional(Schema.String).annotate({
			description: "Present only when `code = INVALID_AGENT_TYPE_PREFIX`. The required `<hostKind>-` prefix.",
		}),
	}),
}).annotate({ identifier: "RegisterAgentFailure" });

/**
 * The `register_agent` tool's success payload.
 *
 * @public
 */
export const RegisterAgentResult = Schema.Union([RegisterAgentSuccess, RegisterAgentFailure]).annotate({
	identifier: "RegisterAgentResult",
	title: "register_agent result",
	description: "Discriminate on `ok`. The four failure codes are documented per their `code` literal.",
});
/**
 * The decoded {@link RegisterAgentResult}.
 *
 * @public
 */
export type RegisterAgentOutput = Schema.Schema.Type<typeof RegisterAgentResult>;

/**
 * Handler for {@link registerAgentTool}. Idempotency is the tool's own
 * business rule (the `agents` idempotency key), not the generic
 * `withIdempotency` combinator.
 *
 * @public
 */
export const handleRegisterAgent = (
	input: RegisterAgentInputType,
): Effect.Effect<RegisterAgentOutput, never, DataReader | DataStore> =>
	Effect.gen(function* () {
		const hostKind = input.hostKind ?? "claude-code";
		const expectedPrefix = `${hostKind}-`;
		if (!input.agentType.startsWith(expectedPrefix)) {
			return {
				ok: false,
				error: {
					code: "INVALID_AGENT_TYPE_PREFIX",
					message: `agentType "${input.agentType}" must start with "${expectedPrefix}"`,
					expectedPrefix,
				},
			} satisfies RegisterAgentOutput;
		}

		const clientNonce = input.clientNonce ?? `${input.chatId}|${input.agentType}|${input.parentAgentId ?? "__ROOT__"}`;

		const idempotencyKey = deriveIdempotencyKey({
			agentType: input.agentType,
			parentAgentId: input.parentAgentId ?? null,
			clientNonce,
		});

		const reader = yield* DataReader;
		const store = yield* DataStore;

		const sessionOpt = yield* reader.getSessionByChatId(input.chatId);
		if (Option.isNone(sessionOpt)) {
			return {
				ok: false,
				error: {
					code: "SESSION_NOT_FOUND",
					message: `chat ${input.chatId} has not been registered; the host must call its SessionStart equivalent first`,
				},
			} satisfies RegisterAgentOutput;
		}
		const sessionRowId = sessionOpt.value.id;

		const result = yield* store
			.registerAgent({
				sessionId: sessionRowId,
				agentType: input.agentType,
				parentAgentId: input.parentAgentId ?? null,
				conversationId: input.conversationId ?? null,
				startedAt: Math.floor(Date.now() / 1000),
				...(input.startGitBranch !== undefined && { startGitBranch: input.startGitBranch }),
				...(input.startGitCommitSha !== undefined && { startGitCommitSha: input.startGitCommitSha }),
				...(input.startWorktreeDir !== undefined && { startWorktreeDir: input.startWorktreeDir }),
				idempotencyKey,
			})
			.pipe(
				Effect.catchTag("RegistrationConflictError", (e) =>
					Effect.succeed({
						_tag: "Conflict" as const,
						reason: e.reason,
					}),
				),
			);

		if ("_tag" in result && result._tag === "Conflict") {
			return {
				ok: false,
				error: {
					code: "PARENT_AGENT_NOT_FOUND",
					message: result.reason,
				},
			} satisfies RegisterAgentOutput;
		}

		if ("_tag" in result && result._tag === "IdempotencyHit") {
			return {
				ok: false,
				error: {
					code: "AGENT_ALREADY_REGISTERED",
					message: "agent already registered for (chatId, agentType, parentAgentId, clientNonce); use existingAgentId",
					existingAgentId: result.existingAgentId,
				},
			} satisfies RegisterAgentOutput;
		}

		return {
			ok: true,
			agentId: result.agentId,
			conversationId: result.conversationId,
			idempotencyKey: result.idempotencyKey,
		} satisfies RegisterAgentOutput;
	}).pipe(Effect.orDie);

/**
 * The Effect-native `register_agent` tool.
 *
 * @public
 */
export const registerAgentTool = Tool.make("register_agent", {
	description:
		"Use when an LLM-agent invocation starts and must be recorded in the per-project store. Idempotent on (chatId, agentType, parentAgentId, clientNonce). Returns ok:true with agentId on insert, or ok:false with error.code='AGENT_ALREADY_REGISTERED'/'PARENT_AGENT_NOT_FOUND'/'SESSION_NOT_FOUND'/'INVALID_AGENT_TYPE_PREFIX' on the four documented failure modes. agentType must begin with the host-kind prefix (e.g., 'claude-code-main').",
	parameters: RegisterAgentInput,
	success: RegisterAgentResult,
	dependencies: [DataReader, DataStore],
})
	.annotate(Tool.Title, "Register agent")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)
	.annotate(Tool.Idempotent, true);
