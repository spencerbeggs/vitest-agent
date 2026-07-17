import { Effect, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { AgentContext, RunContext, RunContextService } from "../services/RunContext.js";
import { probeHostMetadataFromEnv } from "../utils/probe-host-metadata.js";

type Spawner = (typeof ChildProcessSpawner.ChildProcessSpawner)["Service"];

const runGit = (spawner: Spawner, cwd: string, args: ReadonlyArray<string>): Effect.Effect<Option.Option<string>> =>
	spawner.string(ChildProcess.make("git", args).pipe(ChildProcess.setCwd(cwd))).pipe(
		Effect.map((output) => {
			const trimmed = output.trim();
			return trimmed.length > 0 ? Option.some(trimmed) : Option.none<string>();
		}),
		Effect.catch(() => Effect.succeed(Option.none<string>())),
	);

const captureRunContextEffect = (
	cwd: string,
	spawner: Spawner,
	env: Record<string, string | undefined>,
): Effect.Effect<RunContext> =>
	Effect.gen(function* () {
		const branch = yield* runGit(spawner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		const sha = yield* runGit(spawner, cwd, ["rev-parse", "HEAD"]);
		const dirtyOut = yield* runGit(spawner, cwd, ["status", "--porcelain"]);
		const upstream = yield* runGit(spawner, cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
		const worktree = yield* runGit(spawner, cwd, ["rev-parse", "--show-toplevel"]);

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
	});

const captureAgentContextEffect = (cwd: string, spawner: Spawner): Effect.Effect<AgentContext> =>
	Effect.gen(function* () {
		const branch = yield* runGit(spawner, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		const sha = yield* runGit(spawner, cwd, ["rev-parse", "HEAD"]);
		const worktree = yield* runGit(spawner, cwd, ["rev-parse", "--show-toplevel"]);
		return new AgentContext({
			startGitBranch: Option.getOrNull(branch),
			startGitCommitSha: Option.getOrNull(sha),
			startWorktreeDir: Option.getOrNull(worktree),
		});
	});

/**
 * Live layer. Requires `ChildProcessSpawner` (provided by
 * `NodeServices.layer` at the entry point). Reads `process.env`
 * directly for host-metadata probes — the env walk is pure but the
 * env source is process-global, captured once when the layer
 * constructs.
 * @public
 */
export const RunContextLive: Layer.Layer<RunContextService, never, ChildProcessSpawner.ChildProcessSpawner> =
	Layer.effect(
		RunContextService,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			return {
				captureRunContext: (cwd: string) => captureRunContextEffect(cwd, spawner, process.env),
				captureAgentContext: (cwd: string) => captureAgentContextEffect(cwd, spawner),
			};
		}),
	);

/**
 * Build a Test layer that returns fixed `RunContext` and
 * `AgentContext` values regardless of `cwd`.
 * @public
 */
export const RunContextTest = (fixture: {
	readonly runContext: RunContext;
	readonly agentContext: AgentContext;
}): Layer.Layer<RunContextService, never, never> =>
	Layer.succeed(RunContextService, {
		captureRunContext: () => Effect.succeed(fixture.runContext),
		captureAgentContext: () => Effect.succeed(fixture.agentContext),
	});
