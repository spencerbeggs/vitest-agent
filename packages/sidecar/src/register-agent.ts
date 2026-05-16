/**
 * Sidecar `register-agent` subcommand.
 *
 * Composes the full `register-agent` Effect from the programmatic
 * exports of `vitest-agent-cli`. The path resolution, `SidecarLive`
 * composition, and input shape are byte-identical to the
 * `registerAgentSubcommand` handler in
 * `packages/cli/src/commands/agent.ts` — the only difference is that
 * this is a plain async function rather than an `@effect/cli`
 * `Command`, so the SEA binary need not bundle `@effect/cli`.
 *
 * @packageDocumentation
 */

import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import {
	DATA_DB_FILENAME,
	REGISTRY_DB_FILENAME,
	SidecarLive,
	registerAgentEffect,
	resolveProjectDataDir,
	resolveRegistryDir,
	resolveSessionMapPath,
} from "vitest-agent-cli";
import { resolveProjectKeyFromCwd } from "vitest-agent-sdk";

/**
 * Flag inputs accepted by the sidecar `register-agent` subcommand.
 * Mirrors the `@effect/cli` options on `registerAgentSubcommand`.
 */
export interface RunRegisterAgentInput {
	readonly hostKind: string;
	readonly agentType: string;
	readonly hostSessionId: string;
	readonly transcriptPath: string;
	readonly cwd: string;
	readonly parentAgentId?: string;
	readonly clientNonce?: string;
	readonly projectKey?: string;
}

/**
 * Run the end-to-end `register-agent` flow and return the result
 * object. Resolves the project key from `cwd` unless `projectKey`
 * overrides it, builds the three SQLite paths via the shared
 * `sidecar-paths` helpers, constructs `SidecarLive`, and runs
 * `registerAgentEffect`.
 */
export const runRegisterAgent = async (
	input: RunRegisterAgentInput,
): Promise<{
	readonly agentId: string;
	readonly conversationId: string;
	readonly mainAgentId: string;
	readonly idempotencyKey: string;
	readonly idempotencyHit: boolean;
}> => {
	const program = Effect.gen(function* () {
		const projectKey = input.projectKey ?? resolveProjectKeyFromCwd(input.cwd);

		const perProjectDbPath = join(resolveProjectDataDir(projectKey), DATA_DB_FILENAME);
		const registryDbPath = join(resolveRegistryDir(), REGISTRY_DB_FILENAME);
		const sessionMapDbPath = yield* resolveSessionMapPath();

		const sidecar = SidecarLive({
			perProjectDbPath,
			sessionMapDbPath,
			registryDbPath,
		});

		const result = yield* registerAgentEffect({
			hostSessionId: input.hostSessionId,
			transcriptPath: input.transcriptPath,
			cwd: input.cwd,
			hostKind: input.hostKind,
			agentType: input.agentType,
			projectKey,
			...(input.parentAgentId !== undefined && { parentAgentId: input.parentAgentId }),
			...(input.clientNonce !== undefined && { clientNonce: input.clientNonce }),
		}).pipe(Effect.provide(sidecar));

		return {
			agentId: result.agentId,
			conversationId: result.conversationId,
			mainAgentId: result.mainAgentId,
			idempotencyKey: result.idempotencyKey,
			idempotencyHit: result.idempotencyHit,
		};
	}).pipe(Effect.provide(NodeContext.layer));

	return Effect.runPromise(program);
};
