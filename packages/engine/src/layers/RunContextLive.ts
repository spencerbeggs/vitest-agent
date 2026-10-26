import { Git } from "@effected/git";
import { probeHostMetadataFromEnv } from "@vitest-agent/sdk";
import { Effect, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AgentContext, RunContext, RunContextService } from "../services/RunContext.js";

type Spawner = (typeof ChildProcessSpawner.ChildProcessSpawner)["Service"];
type GitService = (typeof Git)["Service"];

/** Every git failure (not a repository, no `git` on PATH, an unborn HEAD) is "no answer". */
const orNull = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A | null> =>
	effect.pipe(Effect.orElseSucceed(() => null));

// TODO(kit-ports): `Git.currentBranch` answers `Option.none` on a detached
// HEAD; 2.x persisted the literal "HEAD" in `git_branch` / `start_git_branch`,
// so that literal is kept until the upstream contract question (whether a
// detached HEAD should be stored as "HEAD" or as null) is settled.
const DETACHED_HEAD = "HEAD";

const branchOf = (git: GitService, cwd: string): Effect.Effect<string | null> =>
	orNull(git.currentBranch(cwd).pipe(Effect.map(Option.getOrElse(() => DETACHED_HEAD))));

const shaOf = (git: GitService, cwd: string): Effect.Effect<string | null> => orNull(git.revParse(cwd, "HEAD"));

const toplevelOf = (git: GitService, cwd: string): Effect.Effect<string | null> => orNull(git.repoRoot(cwd));

// `normal` matches the former bare `git status --porcelain` on the one axis
// this reads (any entry at all), and is cheaper than `all` on a large
// untracked tree.
const dirtyOf = (git: GitService, cwd: string): Effect.Effect<boolean | null> =>
	orNull(git.status(cwd, { untrackedFiles: "normal" }).pipe(Effect.map((entries) => entries.length > 0)));

// TODO(kit-ports): move onto `Git.upstream` once the kit ships it. Until then
// this is the one hand-spawned git call left: `git rev-parse --abbrev-ref
// @{upstream}`, empty or failed output meaning no upstream.
const upstreamOf = (spawner: Spawner, cwd: string): Effect.Effect<string | null> =>
	spawner
		.string(ChildProcess.make("git", ["rev-parse", "--abbrev-ref", "@{upstream}"]).pipe(ChildProcess.setCwd(cwd)))
		.pipe(
			Effect.map((output) => {
				const trimmed = output.trim();
				return trimmed.length > 0 ? trimmed : null;
			}),
			Effect.orElseSucceed(() => null),
		);

const captureRunContextEffect = (
	cwd: string,
	git: GitService,
	spawner: Spawner,
	env: Record<string, string | undefined>,
): Effect.Effect<RunContext> =>
	Effect.gen(function* () {
		const gitBranch = yield* branchOf(git, cwd);
		const gitCommitSha = yield* shaOf(git, cwd);
		const gitDirty = yield* dirtyOf(git, cwd);
		const gitUpstream = yield* upstreamOf(spawner, cwd);
		const gitWorktreeDir = yield* toplevelOf(git, cwd);

		const host = probeHostMetadataFromEnv(env);

		return new RunContext({
			gitBranch,
			gitCommitSha,
			gitDirty,
			gitUpstream,
			gitWorktreeDir,
			hostSource: host.source,
			hostValue: host.value,
			hostMetadata: host.metadata,
		});
	});

const captureAgentContextEffect = (cwd: string, git: GitService): Effect.Effect<AgentContext> =>
	Effect.gen(function* () {
		return new AgentContext({
			startGitBranch: yield* branchOf(git, cwd),
			startGitCommitSha: yield* shaOf(git, cwd),
			startWorktreeDir: yield* toplevelOf(git, cwd),
		});
	});

/**
 * Live layer. Requires `ChildProcessSpawner` (provided by
 * `NodeServices.layer` at the entry point), which feeds `@effected/git`'s
 * `Git` for branch / sha / dirty / toplevel and the one remaining raw
 * `@{upstream}` probe. Every git failure is recorded as `null`. Host-metadata probes read
 * the injected `env` map — the env walk is pure and the map is captured
 * once when the layer is built.
 *
 * @param env - the environment map to probe (the front end passes `process.env`)
 * @public
 */
export const RunContextLive = (
	env: Record<string, string | undefined>,
): Layer.Layer<RunContextService, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Layer.effect(
		RunContextService,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const git = yield* Git;
			return {
				captureRunContext: (cwd: string) => captureRunContextEffect(cwd, git, spawner, env),
				captureAgentContext: (cwd: string) => captureAgentContextEffect(cwd, git),
			};
		}),
	).pipe(Layer.provide(Git.layer));

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
