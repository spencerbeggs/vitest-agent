import { Git } from "@effected/git";
import { Effect, Layer, Option } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { AgentContext, RunContext, RunContextService } from "../services/RunContext.js";
import { probeHostMetadataFromEnv } from "../utils/host-metadata.js";

type GitService = (typeof Git)["Service"];

/** Every git failure (not a repository, no `git` on PATH, an unborn HEAD) is "no answer". */
const orNull = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A | null> =>
	effect.pipe(Effect.orElseSucceed(() => null));

// `Git.currentBranch` answers `Option.none` on a detached HEAD (the kit's
// documented contract); 2.x persisted the literal "HEAD" in `git_branch` /
// `start_git_branch`, so that literal is kept for existing rows to compare.
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

// `git rev-parse --abbrev-ref @{upstream}`'s name, byte for byte. `None`
// (detached HEAD, unborn branch, no upstream) is `null`. A deleted upstream
// is `Some({ gone: true })` and records its name, where the former spawn
// failed and recorded `null`.
const upstreamOf = (git: GitService, cwd: string): Effect.Effect<string | null> =>
	orNull(git.upstream(cwd).pipe(Effect.map((upstream) => Option.getOrNull(Option.map(upstream, (u) => u.name)))));

const captureRunContextEffect = (
	cwd: string,
	git: GitService,
	env: Record<string, string | undefined>,
): Effect.Effect<RunContext> =>
	Effect.gen(function* () {
		const gitBranch = yield* branchOf(git, cwd);
		const gitCommitSha = yield* shaOf(git, cwd);
		const gitDirty = yield* dirtyOf(git, cwd);
		const gitUpstream = yield* upstreamOf(git, cwd);
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
 * `Git` for branch / sha / dirty / upstream / toplevel. Every git failure is
 * recorded as `null`. Host metadata comes from `probeHostMetadataFromEnv`
 * over the injected `env` map, captured once when the layer is built.
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
			const git = yield* Git;
			return {
				captureRunContext: (cwd: string) => captureRunContextEffect(cwd, git, env),
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
