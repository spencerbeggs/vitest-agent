/**
 * Sidecar `_internal end-agent` implementation.
 *
 * Sets `agents.ended_at` on the per-project store. For main-agent
 * stops (SessionEnd), the caller also passes `--host-session-id` so
 * the per-client session map's `ended_at` is updated and
 * `lookupByProjectDir` no longer returns the row as the active
 * session. For subagent stops (SubagentStop), the host session stays
 * open — only the subagent's `agents` row is closed.
 *
 * @packageDocumentation
 */

import { Effect } from "effect";
import { DataStore, PerClientSessionMapWriter } from "vitest-agent-sdk";

export interface EndAgentInput {
	readonly agentId: string;
	readonly endedAt: number;
	/**
	 * When set, also marks the session map row for this host_session_id
	 * as ended. Used by SessionEnd; omitted by SubagentStop.
	 */
	readonly hostSessionId?: string;
}

/**
 * End an agent. Closes the `agents` row, optionally also closes the
 * `session_map` row.
 */
export const endAgentEffect = (input: EndAgentInput) =>
	Effect.gen(function* () {
		const store = yield* DataStore;
		yield* store.endAgent(input.agentId, input.endedAt);
		if (input.hostSessionId !== undefined) {
			const sessionMap = yield* PerClientSessionMapWriter;
			yield* sessionMap.endSession(input.hostSessionId, input.endedAt);
		}
	});
