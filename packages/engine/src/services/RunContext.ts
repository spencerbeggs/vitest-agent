import type { Effect } from "effect";
import { Context, Schema } from "effect";

/**
 * Per-run snapshot of the workspace's git state and host context.
 * Every field is nullable: a non-git workspace has all-NULL git
 * fields, a CI run with no terminal probe match has all-NULL host
 * fields, and a worker that can't read upstream info has a NULL
 * `gitUpstream` while everything else is set.
 *
 * Declared as a `Schema.Class` so callers can `new RunContext({...})`
 * and `Schema.encode(...)` for the SQLite row mapping.
 * @public
 */
export class RunContext extends Schema.Class<RunContext>("vitest-agent/RunContext")({
	gitBranch: Schema.NullOr(Schema.String),
	gitCommitSha: Schema.NullOr(Schema.String),
	gitDirty: Schema.NullOr(Schema.Boolean),
	gitUpstream: Schema.NullOr(Schema.String),
	gitWorktreeDir: Schema.NullOr(Schema.String),
	hostSource: Schema.NullOr(Schema.String),
	hostValue: Schema.NullOr(Schema.String),
	hostMetadata: Schema.NullOr(Schema.Unknown),
}) {}

/**
 * Subset of {@link RunContext} captured at agent registration. Only
 * the inheritable git context — branch, sha, worktree path. Mid-run
 * dirty-tree state and upstream tracking are per-run concerns.
 * @public
 */
export class AgentContext extends Schema.Class<AgentContext>("vitest-agent/AgentContext")({
	startGitBranch: Schema.NullOr(Schema.String),
	startGitCommitSha: Schema.NullOr(Schema.String),
	startWorktreeDir: Schema.NullOr(Schema.String),
}) {}

/**
 * Service tag. The Live layer captures real I/O; the Test layer
 * returns whatever the test fixture passes.
 * @public
 */
export class RunContext$ extends Context.Service<
	RunContext$,
	{
		readonly captureRunContext: (cwd: string) => Effect.Effect<RunContext>;
		readonly captureAgentContext: (cwd: string) => Effect.Effect<AgentContext>;
	}
>()("vitest-agent/RunContextService") {}

/**
 * Re-export the service tag under a less-collision-prone name. The
 * `RunContext` Schema.Class above shares its symbol-name with the
 * service tag concept; the `$` suffix on the Context.Tag class name
 * keeps both addressable from the same module.
 *
 * @public
 */
export const RunContextService = RunContext$;
/** @public */
export type RunContextService = RunContext$;
