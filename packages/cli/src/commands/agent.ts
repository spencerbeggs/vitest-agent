// `agent` subcommand namespace.
//
// Commands intended for agents and hook scripts — humans typically do
// not invoke these directly. The group composes the hook-driven
// utilities (triage, wrapup, record) with the sidecar invocations
// called by plugins/claude-code/hooks/*.sh scripts (register-agent, end-agent,
// inject-env).
//
// The sidecar subcommands return plain text on stdout that the bash
// hooks parse, and structured error info on stderr in the shape
// `<exit_code> <error_tag>: <message>`.
//
// Exit codes follow the contract documented in the agent-agnostic
// taxonomy plan:
//   0 = success
//   1 = registration conflict
//   2 = sidecar timeout
//   3 = database error
//   4 = project identity not resolvable
//   5 = other unexpected defect
//
// `check-test-path` is not part of that family and does not share the
// taxonomy: it exits 1, with nothing on stdout, to mean "no verdict was
// rendered — fail open."

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliExit } from "@effected/cli-kit";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";
import {
	SidecarPlatformLive,
	endAgentEffect,
	registerAgentEffect,
	resolveHookPaths,
	resolveProjectKeyFromCwdEffect,
} from "@vitest-agent/engine";
import {
	VITEST_CONFIG_FILES,
	classifyTestPath,
	detectNonDefaultDiscoverStrategy,
	findOwningWorkspace,
} from "@vitest-agent/sdk";
import { injectEnv } from "@vitest-agent/sdk/dispatch";
import { resolveSidecarBinaryPath } from "@vitest-agent/sidecar";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { failureCode } from "../lib/failure-code.js";
import { currentCwd } from "./flag-defaults.js";
import { recordCommand } from "./record.js";
import { triageCommand } from "./triage.js";
import { wrapupCommand } from "./wrapup.js";

const writeStdout = (line: string): Effect.Effect<void> =>
	Effect.sync(() => {
		process.stdout.write(`${line}\n`);
	});

/**
 * Runs a hook step, turning any cause into the sidecar family's stderr line
 * plus a recorded exit code. `CliExit.reportCause` SUCCEEDS on purpose: a
 * failure would carry its own exit code, which beats the `CliExit` cell.
 * `Option.none()` means the step failed and was reported: the handler must
 * return without writing stdout.
 */
const orReportCause = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<Option.Option<A>, never, R | CliExit> =>
	self.pipe(
		Effect.map(Option.some),
		Effect.catchCause((cause) => CliExit.reportCause(cause, failureCode).pipe(Effect.as(Option.none<A>()))),
	);

// register-agent --------------------------------------------------------------

const hostKindOpt = Flag.String("host-kind").pipe(
	Flag.withDescription("Host vendor identifier; e.g. 'claude-code', 'cursor', 'goose'"),
);
const agentTypeOpt = Flag.String("agent-type").pipe(
	Flag.withDescription("Agent type, must begin with the host-kind prefix"),
);
const hostSessionIdOpt = Flag.String("host-session-id").pipe(
	Flag.withDescription("Host's native session id (host chat UUID; `session_id` in the CC hook payload)"),
);
const transcriptPathOpt = Flag.String("transcript-path").pipe(
	Flag.withDescription("Path to the host's transcript file (basename UUID is the conversation key)"),
);
const cwdOpt = Flag.String("cwd").pipe(Flag.withDescription("Workspace root directory the agent is running in"));
const parentAgentIdOpt = Flag.optional(Flag.String("parent-agent-id"));
const clientNonceOpt = Flag.optional(Flag.String("client-nonce"));
const projectKeyOverrideOpt = Flag.optional(Flag.String("project-key"));

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
				: yield* resolveProjectKeyFromCwdEffect(opts.cwd);

			const pathsOpt = yield* orReportCause(resolveHookPaths({ env: process.env, projectKey }));
			if (Option.isNone(pathsOpt)) return;
			const sidecar = SidecarPlatformLive(pathsOpt.value, process.env);

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

			// local: true -- a guard against any ambient data layer. A plain Effect.provide
			// reuses the fiber's inherited layer memo map, so if an outer layer had already
			// built the module-level DataStoreLive / DataReaderLive constants, the sidecar
			// would get that store and --project-key's db would never be written (#561).
			const resultOpt = yield* orReportCause(program.pipe(Effect.provide(sidecar, { local: true })));
			if (Option.isNone(resultOpt)) return;
			const result = resultOpt.value;

			yield* writeStdout(
				JSON.stringify({
					agentId: result.agentId,
					conversationId: result.conversationId,
					mainAgentId: result.mainAgentId,
					idempotencyKey: result.idempotencyKey,
					idempotencyHit: result.idempotencyHit,
				}),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
).pipe(Command.withDescription("Register an agent invocation in the per-project store and the per-client session map"));

// end-agent ------------------------------------------------------------------

const agentIdOpt = Flag.String("agent-id").pipe(
	Flag.withDescription("The agent_id (UUID) returned by an earlier register-agent call"),
);
const endedAtOpt = Flag.optional(Flag.Int("ended-at"));
const endHostSessionIdOpt = Flag.optional(Flag.String("host-session-id"));
const endCwdOpt = Flag.String("cwd").pipe(
	Flag.withDefault(currentCwd),
	Flag.withDescription("Workspace root, used to locate the per-project data.db"),
);
const endProjectKeyOverrideOpt = Flag.optional(Flag.String("project-key"));

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
				: yield* resolveProjectKeyFromCwdEffect(opts.cwd);

			const pathsOpt = yield* orReportCause(resolveHookPaths({ env: process.env, projectKey }));
			if (Option.isNone(pathsOpt)) return;
			const sidecar = SidecarPlatformLive(pathsOpt.value, process.env);

			const endedAt = Option.isSome(opts.endedAt) ? opts.endedAt.value : Math.floor(Date.now() / 1000);

			// local: true -- a guard against any ambient data layer. A plain Effect.provide
			// reuses the fiber's inherited layer memo map, so if an outer layer had already
			// built the module-level DataStoreLive / DataReaderLive constants, the sidecar
			// would get that store and --project-key's db would never be written (#561).
			yield* orReportCause(
				endAgentEffect({
					agentId: opts.agentId,
					endedAt,
					...(Option.isSome(opts.hostSessionId) && { hostSessionId: opts.hostSessionId.value }),
				}).pipe(Effect.provide(sidecar, { local: true })),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
).pipe(Command.withDescription("Mark an agent (and optionally its session) as ended"));

// inject-env -----------------------------------------------------------------

const commandOpt = Flag.String("command").pipe(
	Flag.withDescription("The Bash command to (possibly) rewrite with VITEST_AGENT_* env-prefix"),
);
const cwdInjectOpt = Flag.String("cwd").pipe(
	Flag.withDefault(currentCwd),
	Flag.withDescription("Working directory; used to find package.json scripts"),
);

export const injectEnvSubcommand = Command.make("inject-env", { command: commandOpt, cwd: cwdInjectOpt }, (opts) =>
	Effect.sync(() => {
		const out = injectEnv({
			command: opts.command,
			cwd: opts.cwd,
			env: process.env,
			readFile: (path) => readFileSync(path, "utf-8"),
		});
		process.stdout.write(`${out}\n`);
	}),
).pipe(Command.withDescription("Rewrite a Bash command to prepend VITEST_AGENT_* env vars when it invokes Vitest"));

// sidecar-path ---------------------------------------------------------------

export const sidecarPathSubcommand = Command.make("sidecar-path", {}, () =>
	Effect.gen(function* () {
		const path = resolveSidecarBinaryPath();
		// No binary for this platform: exit 1 with nothing on stdout.
		if (path === null) return yield* CliExit.set(1);
		yield* writeStdout(path);
	}),
).pipe(Command.withDescription("Print the absolute path of the platform sidecar binary resolved via require.resolve"));

// check-test-path -------------------------------------------------------------

const testPathArg = Argument.String("path").pipe(
	Argument.withDescription(
		"Path to classify against the workspace test layout; relative paths resolve against VITEST_AGENT_PROJECT_DIR, or cwd when that is unset",
	),
);

/**
 * True when any directory between `ownerPath` and `filePath`'s own directory
 * declares its own `package.json`.
 *
 * This is the one boundary `classifyTestPath` cannot check: a nested manifest
 * marks an independent unit — a vendored upstream checkout under `.repos/`, a
 * fixture package shaped like a real one — whose tests belong to a different
 * discovery pass. `findTestFiles` stops there, so the layout rule has nothing
 * to say about what sits beyond it, and the caller must fail open. The probe
 * lives in this seam rather than in the pure classifier because it needs the
 * filesystem.
 *
 * @internal
 */
function crossesNestedPackageBoundary(ownerPath: string, filePath: string): boolean {
	const rel = relative(ownerPath, dirname(filePath));
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
	let dir = ownerPath;
	for (const segment of rel.split(sep)) {
		dir = join(dir, segment);
		if (existsSync(join(dir, "package.json"))) return true;
	}
	return false;
}

/**
 * Reads the first Vitest/Vite config file found at `root`, returning its
 * source text, or `null` when none of sdk's `VITEST_CONFIG_FILES` (the names
 * Vitest 5 itself loads, in its order) exists
 * or the file that does exist cannot be read.
 *
 * A `null` result is deliberately indistinguishable between "no config file"
 * and "unreadable config file" — both mean the caller cannot rule out a
 * non-default `DiscoverStrategy` and must fail open (issue #230).
 * @internal
 */
function readWorkspaceVitestConfigSource(root: string): string | null {
	for (const candidate of VITEST_CONFIG_FILES) {
		const candidatePath = join(root, candidate);
		if (!existsSync(candidatePath)) continue;
		try {
			return readFileSync(candidatePath, "utf8");
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * The `check-test-path` verdict, or `null` when no verdict can be rendered and
 * the caller must fail open.
 *
 * @internal
 */
function checkTestPath(path: string, from: string): ReturnType<typeof classifyTestPath> {
	const absolute = isAbsolute(path) ? path : resolve(from, path);

	const root = findWorkspaceRootSync(from, nodeSyncOps);
	if (root === null) return null;

	// Loading the consumer's Vitest config to determine the discovery
	// strategy actually in force is out of scope for this hook-hot-path
	// command. Instead, scan the config source text lexically for markers of
	// a non-default DiscoverStrategy and fail open when one is present, or
	// when the config cannot be read at all — a confidently wrong deny is
	// worse than no verdict (issue #230).
	const configSource = readWorkspaceVitestConfigSource(root);
	if (configSource === null || detectNonDefaultDiscoverStrategy(configSource)) return null;

	const packages = getWorkspacePackagesSync(root, nodeSyncOps);

	const owner = findOwningWorkspace(packages, absolute);
	if (owner === null) return null;
	if (crossesNestedPackageBoundary(owner.path, absolute)) return null;

	// A null classification means no workspace contains the path, or the path
	// crosses a directory discovery never walks into. Either way the rule has
	// nothing to say.
	return classifyTestPath(packages, absolute);
}

export const checkTestPathSubcommand = Command.make("check-test-path", { path: testPathArg }, (opts) =>
	Effect.gen(function* () {
		const from = process.env.VITEST_AGENT_PROJECT_DIR ?? process.cwd();
		const classification = yield* Effect.sync(() => checkTestPath(opts.path, from));
		// Every null means the same thing: no verdict was rendered, so callers
		// must fail open. Exit 1 with nothing on stdout.
		if (classification === null) return yield* CliExit.set(1);
		yield* writeStdout(JSON.stringify(classification));
	}),
).pipe(Command.withDescription("Classify a test file path as valid, excluded, or invalid for Vitest discovery"));

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
		sidecarPathSubcommand,
		checkTestPathSubcommand,
	]),
);
