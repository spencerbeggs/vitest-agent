/**
 * Live and Test layers for {@link RunContextService}.
 *
 * The Live layer wraps `Command.string` for each git probe and the
 * env-walk for host metadata. Failed git commands surface as `null`
 * columns (not errors) — non-git workspaces are valid.
 *
 * @packageDocumentation
 */

import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import { AgentContext, RunContext, RunContextService } from "../services/RunContext.js";
import { probeHostMetadataFromEnv } from "../utils/probe-host-metadata.js";

const runGit = (
	cwd: string,
	args: ReadonlyArray<string>,
): Effect.Effect<Option.Option<string>, never, CommandExecutor.CommandExecutor> =>
	Command.make("git", ...args).pipe(
		Command.workingDirectory(cwd),
		Command.string,
		Effect.map((output) => {
			const trimmed = output.trim();
			return trimmed.length > 0 ? Option.some(trimmed) : Option.none<string>();
		}),
		Effect.catchAll(() => Effect.succeed(Option.none<string>())),
	);

const captureRunContextEffect = (
	cwd: string,
	executor: CommandExecutor.CommandExecutor,
	env: Record<string, string | undefined>,
): Effect.Effect<RunContext> =>
	Effect.gen(function* () {
		const branch = yield* runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		const sha = yield* runGit(cwd, ["rev-parse", "HEAD"]);
		const dirtyOut = yield* runGit(cwd, ["status", "--porcelain"]);
		const upstream = yield* runGit(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
		const worktree = yield* runGit(cwd, ["rev-parse", "--show-toplevel"]);

		const dirtyValue = Option.match(dirtyOut, {
			onNone: () => null,
			onSome: (out) => out.length > 0,
		});

		const host = probeHostMetadataFromEnv(env);

		return new RunContext({
			gitBranch: Option.getOrNull(branch),
			gitCommitSha: Option.getOrNull(sha),
			gitDirty: dirtyValue,
			gitUpstream: Option.getOrNull(upstream),
			gitWorktreeDir: Option.getOrNull(worktree),
			hostSource: host.source,
			hostValue: host.value,
			hostMetadata: host.metadata,
		});
	}).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor));

const captureAgentContextEffect = (
	cwd: string,
	executor: CommandExecutor.CommandExecutor,
): Effect.Effect<AgentContext> =>
	Effect.gen(function* () {
		const branch = yield* runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		const sha = yield* runGit(cwd, ["rev-parse", "HEAD"]);
		const worktree = yield* runGit(cwd, ["rev-parse", "--show-toplevel"]);
		return new AgentContext({
			startGitBranch: Option.getOrNull(branch),
			startGitCommitSha: Option.getOrNull(sha),
			startWorktreeDir: Option.getOrNull(worktree),
		});
	}).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor));

/**
 * Live layer. Requires `CommandExecutor` (provided by
 * `NodeContext.layer` at the entry point). Reads `process.env`
 * directly for host-metadata probes — the env walk is pure but the
 * env source is process-global, captured once when the layer
 * constructs.
 */
export const RunContextLive: Layer.Layer<RunContextService, never, CommandExecutor.CommandExecutor> = Layer.effect(
	RunContextService,
	Effect.gen(function* () {
		const executor = yield* CommandExecutor.CommandExecutor;
		return {
			captureRunContext: (cwd: string) => captureRunContextEffect(cwd, executor, process.env),
			captureAgentContext: (cwd: string) => captureAgentContextEffect(cwd, executor),
		};
	}),
);

/**
 * Build a Test layer that returns fixed `RunContext` and
 * `AgentContext` values regardless of `cwd`.
 */
export const RunContextTest = (fixture: {
	readonly runContext: RunContext;
	readonly agentContext: AgentContext;
}): Layer.Layer<RunContextService, never, never> =>
	Layer.succeed(RunContextService, {
		captureRunContext: () => Effect.succeed(fixture.runContext),
		captureAgentContext: () => Effect.succeed(fixture.agentContext),
	});
