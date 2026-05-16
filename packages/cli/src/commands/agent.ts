/**
 * `agent` subcommand namespace.
 *
 * Commands intended for agents and hook scripts — humans typically do
 * not invoke these directly. The group composes the hook-driven
 * utilities (triage, wrapup, record) with the sidecar invocations
 * called by plugin/hooks/*.sh scripts (register-agent, end-agent,
 * inject-env).
 *
 * The sidecar subcommands return plain text on stdout that the bash
 * hooks parse, and structured error info on stderr in the shape
 * `<exit_code> <error_tag>: <message>`.
 *
 * Exit codes follow the contract documented in the agent-agnostic
 * taxonomy plan:
 *   0 = success
 *   1 = registration conflict
 *   2 = sidecar timeout
 *   3 = database error
 *   4 = project identity not resolvable
 *   5 = other unexpected defect
 *
 * @packageDocumentation
 */

import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Cause, Chunk, Effect, Option } from "effect";
import { resolveProjectKeyFromCwd } from "vitest-agent-sdk";
import { SidecarLive } from "../layers/SidecarLive.js";
import { endAgentEffect } from "../lib/internal-end-agent.js";
import { injectEnv } from "../lib/internal-inject-env.js";
import { registerAgentEffect } from "../lib/internal-register-agent.js";
import {
	DATA_DB_FILENAME,
	REGISTRY_DB_FILENAME,
	exitCodeForTag,
	resolveProjectDataDir,
	resolveRegistryDir,
	resolveSessionMapPath,
} from "../lib/sidecar-paths.js";
import { recordCommand } from "./record.js";
import { triageCommand } from "./triage.js";
import { wrapupCommand } from "./wrapup.js";

const writeStdout = (line: string): Effect.Effect<void> =>
	Effect.sync(() => {
		process.stdout.write(`${line}\n`);
	});

const writeStderrAndExit = (exitCode: number, tag: string, message: string): Effect.Effect<never> =>
	Effect.sync(() => {
		process.stderr.write(`${exitCode} ${tag}: ${message}\n`);
		process.exit(exitCode);
	}) as Effect.Effect<never>;

const mapDefectToExit = (cause: Cause.Cause<unknown>): Effect.Effect<never> => {
	const failures = Chunk.toReadonlyArray(Cause.failures(cause));
	if (failures.length > 0) {
		const tagged = failures[0] as { _tag?: string; reason?: string; message?: string };
		const tag = tagged._tag ?? "UnknownError";
		const message = tagged.reason ?? tagged.message ?? String(failures[0]);
		const exitCode = exitCodeForTag(tag);
		return writeStderrAndExit(exitCode, tag, message);
	}
	const defects = Chunk.toReadonlyArray(Cause.defects(cause));
	const defect = defects[0];
	const message = defect instanceof Error ? defect.message : String(defect ?? "unknown defect");
	return writeStderrAndExit(5, "Defect", message);
};

// register-agent --------------------------------------------------------------

const hostKindOpt = Options.text("host-kind").pipe(
	Options.withDescription("Host vendor identifier; e.g. 'claude-code', 'cursor', 'goose'"),
);
const agentTypeOpt = Options.text("agent-type").pipe(
	Options.withDescription("Agent type, must begin with the host-kind prefix"),
);
const hostSessionIdOpt = Options.text("host-session-id").pipe(
	Options.withDescription("Host's native session id (host chat UUID; `session_id` in the CC hook payload)"),
);
const transcriptPathOpt = Options.text("transcript-path").pipe(
	Options.withDescription("Path to the host's transcript file (basename UUID is the conversation key)"),
);
const cwdOpt = Options.text("cwd").pipe(Options.withDescription("Workspace root directory the agent is running in"));
const parentAgentIdOpt = Options.optional(Options.text("parent-agent-id"));
const clientNonceOpt = Options.optional(Options.text("client-nonce"));
const projectKeyOverrideOpt = Options.optional(Options.text("project-key"));

export const registerAgentSubcommand = Command.make(
	"register-agent",
	{
		hostKind: hostKindOpt,
		agentType: agentTypeOpt,
		hostSessionId: hostSessionIdOpt,
		transcriptPath: transcriptPathOpt,
		cwd: cwdOpt,
		parentAgentId: parentAgentIdOpt,
		clientNonce: clientNonceOpt,
		projectKeyOverride: projectKeyOverrideOpt,
	},
	(opts) =>
		Effect.gen(function* () {
			const projectKey = Option.isSome(opts.projectKeyOverride)
				? opts.projectKeyOverride.value
				: resolveProjectKeyFromCwd(opts.cwd);

			const perProjectDbPath = join(resolveProjectDataDir(projectKey), DATA_DB_FILENAME);
			const registryDbPath = join(resolveRegistryDir(), REGISTRY_DB_FILENAME);
			const sessionMapDbPath = yield* resolveSessionMapPath().pipe(Effect.catchAllCause(mapDefectToExit));

			const sidecar = SidecarLive({
				perProjectDbPath,
				sessionMapDbPath,
				registryDbPath,
			});

			const program = registerAgentEffect({
				hostSessionId: opts.hostSessionId,
				transcriptPath: opts.transcriptPath,
				cwd: opts.cwd,
				hostKind: opts.hostKind,
				agentType: opts.agentType,
				projectKey,
				...(Option.isSome(opts.parentAgentId) && { parentAgentId: opts.parentAgentId.value }),
				...(Option.isSome(opts.clientNonce) && { clientNonce: opts.clientNonce.value }),
			});

			const result = yield* program.pipe(Effect.provide(sidecar), Effect.catchAllCause(mapDefectToExit));

			yield* writeStdout(
				JSON.stringify({
					agentId: result.agentId,
					conversationId: result.conversationId,
					mainAgentId: result.mainAgentId,
					idempotencyKey: result.idempotencyKey,
					idempotencyHit: result.idempotencyHit,
				}),
			);
		}).pipe(Effect.provide(NodeContext.layer)),
).pipe(Command.withDescription("Register an agent invocation in the per-project store and the per-client session map"));

// end-agent ------------------------------------------------------------------

const agentIdOpt = Options.text("agent-id").pipe(
	Options.withDescription("The agent_id (UUID) returned by an earlier register-agent call"),
);
const endedAtOpt = Options.optional(Options.integer("ended-at"));
const endHostSessionIdOpt = Options.optional(Options.text("host-session-id"));
const endCwdOpt = Options.text("cwd").pipe(
	Options.withDefault(process.cwd()),
	Options.withDescription("Workspace root, used to locate the per-project data.db"),
);
const endProjectKeyOverrideOpt = Options.optional(Options.text("project-key"));

export const endAgentSubcommand = Command.make(
	"end-agent",
	{
		agentId: agentIdOpt,
		endedAt: endedAtOpt,
		hostSessionId: endHostSessionIdOpt,
		cwd: endCwdOpt,
		projectKeyOverride: endProjectKeyOverrideOpt,
	},
	(opts) =>
		Effect.gen(function* () {
			const projectKey = Option.isSome(opts.projectKeyOverride)
				? opts.projectKeyOverride.value
				: resolveProjectKeyFromCwd(opts.cwd);

			const perProjectDbPath = join(resolveProjectDataDir(projectKey), DATA_DB_FILENAME);
			const registryDbPath = join(resolveRegistryDir(), REGISTRY_DB_FILENAME);
			const sessionMapDbPath = yield* resolveSessionMapPath().pipe(Effect.catchAllCause(mapDefectToExit));

			const sidecar = SidecarLive({
				perProjectDbPath,
				sessionMapDbPath,
				registryDbPath,
			});

			const endedAt = Option.isSome(opts.endedAt) ? opts.endedAt.value : Math.floor(Date.now() / 1000);

			yield* endAgentEffect({
				agentId: opts.agentId,
				endedAt,
				...(Option.isSome(opts.hostSessionId) && { hostSessionId: opts.hostSessionId.value }),
			}).pipe(Effect.provide(sidecar), Effect.catchAllCause(mapDefectToExit));
		}).pipe(Effect.provide(NodeContext.layer)),
).pipe(Command.withDescription("Mark an agent (and optionally its session) as ended"));

// inject-env -----------------------------------------------------------------

const commandOpt = Options.text("command").pipe(
	Options.withDescription("The Bash command to (possibly) rewrite with VITEST_AGENT_* env-prefix"),
);
const cwdInjectOpt = Options.text("cwd").pipe(
	Options.withDefault(process.cwd()),
	Options.withDescription("Working directory; used to find package.json scripts"),
);

export const injectEnvSubcommand = Command.make("inject-env", { command: commandOpt, cwd: cwdInjectOpt }, (opts) =>
	Effect.sync(() => {
		const out = injectEnv({ command: opts.command, cwd: opts.cwd, env: process.env });
		process.stdout.write(`${out}\n`);
	}),
).pipe(Command.withDescription("Rewrite a Bash command to prepend VITEST_AGENT_* env vars when it invokes Vitest"));

// agent group -----------------------------------------------------------------

const agentParent = Command.make("agent").pipe(
	Command.withDescription(
		"Commands intended for agents and hook scripts — humans typically don't invoke these directly.",
	),
);

export const agentCommand = agentParent.pipe(
	Command.withSubcommands([
		triageCommand,
		wrapupCommand,
		recordCommand,
		registerAgentSubcommand,
		endAgentSubcommand,
		injectEnvSubcommand,
	]),
);
