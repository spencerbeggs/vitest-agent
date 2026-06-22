/*
 * Sidecar _internal register-agent implementation.
 *
 * Wires together the four services that registration touches:
 *
 *   - PerClientSessionMapWriter — translates the host's native
 *     identifiers (transcript path, host_session_id) into the
 *     canonical conversation_id and main_agent_id UUIDs the
 *     per-project store expects.
 *   - DataStore — performs the idempotent INSERT into the
 *     per-project agents table via registerAgent(...).
 *   - RunContextService — captures start_git_* from the workspace
 *     before insert.
 *   - DataReader — resolves the integer sessions.id FK from the
 *     host_session_id (writes a sessions row first if needed).
 *
 * For main-agent registrations (no parentAgentId), the sidecar also
 * writes the parent sessions row with the same host_session_id +
 * conversation_id so downstream code that queries by integer FK
 * still works.
 */

import {
	DataReader,
	DataStore,
	PerClientSessionMapWriter,
	RunContextService,
	deriveIdempotencyKey,
} from "@vitest-agent/sdk";
import { Effect, Option } from "effect";

/**
 * Input for the end-to-end agent registration effect.
 *
 * @public
 */
export interface RegisterAgentInput {
	/** The host's native session identifier (e.g. Claude's `session_id`). */
	readonly hostSessionId: string;
	/** Absolute path to the host's conversation transcript file. */
	readonly transcriptPath: string;
	/** Working directory of the agent process. */
	readonly cwd: string;
	/** Host kind string (e.g. `"claude-code"`). */
	readonly hostKind: string;
	/** Agent type label (e.g. `"main"` or `"subagent"`). */
	readonly agentType: string;
	/** Normalized project key derived from the workspace root `package.json#name`. */
	readonly projectKey: string;
	/** Agent ID of the parent when registering a subagent. */
	readonly parentAgentId?: string;
	/** Optional idempotency nonce; derived from `hostSessionId + agentType + parentAgentId` when omitted. */
	readonly clientNonce?: string;
}

/**
 * Output of the end-to-end agent registration effect.
 *
 * @public
 */
export interface RegisterAgentOutput {
	/** Canonical UUID assigned to this agent in the per-project store. */
	readonly agentId: string;
	/** UUID of the conversation this agent belongs to. */
	readonly conversationId: string;
	/** Idempotency key used for the `registerAgent` upsert. */
	readonly idempotencyKey: string;
	/** `true` when an existing agent row was recovered rather than inserted. */
	readonly idempotencyHit: boolean;
}

const deriveDefaultClientNonce = (input: RegisterAgentInput): string => {
	const parent = input.parentAgentId ?? "__ROOT__";
	return `${input.hostSessionId}|${input.agentType}|${parent}`;
};

/**
 * End-to-end agent registration.
 *
 * Returns the canonical `agentId` + the conversation it belongs to +
 * the resolved `idempotencyKey`. The `idempotencyHit` flag is `true`
 * when the per-project store recovered an existing agent row instead
 * of inserting a new one.
 *
 * @param input - registration inputs including host identifiers and agent metadata
 * @returns an Effect resolving to `RegisterAgentOutput`
 * @public
 */
export const registerAgentEffect = (input: RegisterAgentInput) =>
	Effect.gen(function* () {
		const sessionMap = yield* PerClientSessionMapWriter;
		const reader = yield* DataReader;
		const store = yield* DataStore;
		const ctx = yield* RunContextService;

		// Step 1: get or create the canonical conversation_id from the
		// transcript path.
		const conversationId = yield* sessionMap.mapConversation(input.transcriptPath);

		// Step 2: get or create the canonical main_agent_id for the
		// host's native session id.
		const sessionMapping = yield* sessionMap.mapSession({
			hostSessionId: input.hostSessionId,
			conversationId,
			projectKey: input.projectKey,
			projectDir: input.cwd,
		});

		// Step 3: ensure the per-project sessions row exists. The
		// agents.session_id FK still references the integer PK.
		const existingSession = yield* reader.getSessionByChatId(input.hostSessionId);
		const sessionRowId = yield* Option.match(existingSession, {
			onNone: () =>
				store.writeSession({
					chatId: input.hostSessionId,
					project: input.projectKey,
					cwd: input.cwd,
					agentKind: input.parentAgentId === undefined ? "main" : "subagent",
					agentType: input.agentType,
					triageWasNonEmpty: false,
					startedAt: new Date().toISOString(),
				}),
			onSome: (s) => Effect.succeed(s.id),
		});

		// Step 4: capture git context the agent inherited.
		const agentContext = yield* ctx.captureAgentContext(input.cwd);

		// Step 5: idempotently insert the agent row.
		const clientNonce = input.clientNonce ?? deriveDefaultClientNonce(input);
		const idempotencyKey = deriveIdempotencyKey({
			agentType: input.agentType,
			parentAgentId: input.parentAgentId ?? null,
			clientNonce,
		});

		const result = yield* store.registerAgent({
			sessionId: sessionRowId,
			agentType: input.agentType,
			parentAgentId: input.parentAgentId ?? null,
			conversationId,
			startedAt: Math.floor(Date.now() / 1000),
			...(agentContext.startGitBranch !== null && { startGitBranch: agentContext.startGitBranch }),
			...(agentContext.startGitCommitSha !== null && { startGitCommitSha: agentContext.startGitCommitSha }),
			...(agentContext.startWorktreeDir !== null && { startWorktreeDir: agentContext.startWorktreeDir }),
			idempotencyKey,
			// Pin the per-project agents.agent_id to the per-client
			// session_map.main_agent_id so the env-exported
			// VITEST_AGENT_MAIN_AGENT_ID joins back to a real agents row.
			agentId: sessionMapping.mainAgentId,
		});

		const isHit = result._tag === "IdempotencyHit";
		const agentId = isHit ? result.existingAgentId : result.agentId;

		return {
			agentId: agentId as string,
			conversationId,
			mainAgentId: sessionMapping.mainAgentId,
			idempotencyKey,
			idempotencyHit: isHit,
		};
	});
