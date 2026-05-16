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

import { Effect, Option, Schema } from "effect";
import { DataReader, DataStore, deriveIdempotencyKey } from "vitest-agent-sdk";
import { publicProcedure } from "../context.js";

const RegisterAgentInput = Schema.Struct({
	chatId: Schema.String,
	conversationId: Schema.optional(Schema.String),
	hostKind: Schema.optional(Schema.String),
	agentType: Schema.String,
	parentAgentId: Schema.optional(Schema.String),
	clientNonce: Schema.optional(Schema.String),
	startGitBranch: Schema.optional(Schema.String),
	startGitCommitSha: Schema.optional(Schema.String),
	startWorktreeDir: Schema.optional(Schema.String),
});

const RegisterAgentSuccess = Schema.Struct({
	ok: Schema.Literal(true).annotations({
		description: "Discriminant — `true` when the agent row was inserted (or an existing one recovered).",
	}),
	agentId: Schema.String.annotations({
		title: "agents.agent_id",
		description: "Canonical UUID for the registered agent — pass to subsequent attribution-bearing calls.",
	}),
	conversationId: Schema.NullOr(Schema.String).annotations({
		description: "Conversation UUID from the host's transcript when one was supplied; `null` otherwise.",
	}),
	idempotencyKey: Schema.String.annotations({
		description:
			"26-char base32 SHA-256 of (agentType, parentAgentId|sentinel, clientNonce). Stable across retries with identical input.",
	}),
}).annotations({ identifier: "RegisterAgentSuccess" });

const RegisterAgentFailure = Schema.Struct({
	ok: Schema.Literal(false).annotations({ description: "Discriminant — `false` when registration was refused." }),
	error: Schema.Struct({
		code: Schema.Literal(
			"AGENT_ALREADY_REGISTERED",
			"PARENT_AGENT_NOT_FOUND",
			"SESSION_NOT_FOUND",
			"INVALID_AGENT_TYPE_PREFIX",
		).annotations({
			description:
				"Refusal reason. AGENT_ALREADY_REGISTERED carries `existingAgentId` so the caller can recover. INVALID_AGENT_TYPE_PREFIX carries `expectedPrefix`.",
		}),
		message: Schema.String.annotations({ description: "Human-readable refusal explanation." }),
		existingAgentId: Schema.optional(Schema.String).annotations({
			description: "Present only when `code = AGENT_ALREADY_REGISTERED`. Use this id instead of registering a new one.",
		}),
		expectedPrefix: Schema.optional(Schema.String).annotations({
			description: "Present only when `code = INVALID_AGENT_TYPE_PREFIX`. The required `<hostKind>-` prefix.",
		}),
	}),
}).annotations({ identifier: "RegisterAgentFailure" });

export const RegisterAgentResult = Schema.Union(RegisterAgentSuccess, RegisterAgentFailure).annotations({
	identifier: "RegisterAgentResult",
	title: "register_agent result",
	description: "Discriminate on `ok`. The four failure codes are documented per their `code` literal.",
});
export type RegisterAgentOutput = Schema.Schema.Type<typeof RegisterAgentResult>;

export const registerAgent = publicProcedure
	.input(Schema.standardSchemaV1(RegisterAgentInput))
	.mutation(async ({ ctx, input }): Promise<RegisterAgentOutput> => {
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
			};
		}

		const clientNonce = input.clientNonce ?? `${input.chatId}|${input.agentType}|${input.parentAgentId ?? "__ROOT__"}`;

		const idempotencyKey = deriveIdempotencyKey({
			agentType: input.agentType,
			parentAgentId: input.parentAgentId ?? null,
			clientNonce,
		});

		return ctx.runtime.runPromise(
			Effect.gen(function* () {
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
							message:
								"agent already registered for (chatId, agentType, parentAgentId, clientNonce); use existingAgentId",
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
			}),
		);
	});
