import type { Effect } from "effect";
import { Context } from "effect";
import type { ProjectIdentityNotResolvableError } from "../errors/ProjectIdentityError.js";
import { canonicalizeGitUrl, gitUrlToProjectKey } from "../utils/canonicalize-git-url.js";
import { normalizeWorkspaceKey } from "../utils/normalize-workspace-key.js";

/**
 * Result of a successful identity resolution.
 *
 * - `projectKey` — filesystem-safe single segment for the per-project
 *   data store directory under `$XDG_DATA_HOME/vitest-agent/`.
 * - `canonicalForm` — human-readable form for display in the discovery
 *   registry. Equal to `projectKey` for non-git sources; for git
 *   sources, the original `host/path` shape (with slashes preserved).
 * - `source` — which source matched. Useful for diagnostics and the
 *   `vitest-agent doctor`-style commands.
 * @public
 */
export interface ResolvedIdentity {
	readonly projectKey: string;
	readonly canonicalForm: string;
	readonly source: ProjectIdentitySource;
}
/** @public */
export type ProjectIdentitySource = "explicit" | "toml" | "git-remote" | "package-repository" | "package-name";

/**
 * Per-source candidate values. Each is optional — an absent or empty
 * value causes the resolver to fall through to the next source.
 *
 * The Live layer collects these from real I/O (config file, git
 * subprocess, `package.json` read). Tests pass a literal object.
 * @public
 */
export interface ProjectIdentityCandidates {
	readonly explicit?: string;
	readonly toml?: string;
	readonly gitRemote?: string;
	readonly packageJsonRepoUrl?: string;
	readonly packageJsonName?: string;
}

/**
 * Options accepted by the `ProjectIdentity.resolve` service method.
 *
 * `projectId` is the priority-1 escape hatch — pass when the user has
 * configured `AgentPlugin({ projectId: "..." })` in `vitest.config.ts`.
 * @public
 */
export interface ResolveProjectIdentityOptions {
	readonly projectId?: string;
}

const isUseful = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

/**
 * Pure priority resolver. Returns `null` when no candidate produces a
 * usable value — the caller wraps `null` into a tagged error.
 *
 * For non-git sources the `canonicalForm` equals the original
 * (un-normalized) input so the discovery registry can display
 * `@spencerbeggs/vitest-agent` rather than the underscored form. For
 * git sources, `canonicalForm` is the slash-preserving `host/path`
 * shape from `canonicalizeGitUrl`.
 * @public
 */
export const resolveProjectIdentityFromCandidates = (
	candidates: ProjectIdentityCandidates,
): ResolvedIdentity | null => {
	if (isUseful(candidates.explicit)) {
		return {
			projectKey: normalizeWorkspaceKey(candidates.explicit),
			canonicalForm: candidates.explicit,
			source: "explicit",
		};
	}

	if (isUseful(candidates.toml)) {
		return {
			projectKey: normalizeWorkspaceKey(candidates.toml),
			canonicalForm: candidates.toml,
			source: "toml",
		};
	}

	if (isUseful(candidates.gitRemote)) {
		const canonical = canonicalizeGitUrl(candidates.gitRemote);
		const key = gitUrlToProjectKey(candidates.gitRemote);
		if (canonical !== null && key !== null) {
			return { projectKey: key, canonicalForm: canonical, source: "git-remote" };
		}
	}

	if (isUseful(candidates.packageJsonRepoUrl)) {
		const canonical = canonicalizeGitUrl(candidates.packageJsonRepoUrl);
		const key = gitUrlToProjectKey(candidates.packageJsonRepoUrl);
		if (canonical !== null && key !== null) {
			return { projectKey: key, canonicalForm: canonical, source: "package-repository" };
		}
	}

	if (isUseful(candidates.packageJsonName)) {
		return {
			projectKey: normalizeWorkspaceKey(candidates.packageJsonName),
			canonicalForm: candidates.packageJsonName,
			source: "package-name",
		};
	}

	return null;
};

/**
 * Service tag. The Live layer (in `layers/ProjectIdentityLive.ts`)
 * wires up the I/O sources; tests provide a stub that returns a
 * pre-built `ResolvedIdentity`.
 * @public
 */
export class ProjectIdentity extends Context.Tag("vitest-agent/ProjectIdentity")<
	ProjectIdentity,
	{
		readonly resolve: (
			workspaceRoot: string,
			options?: ResolveProjectIdentityOptions,
		) => Effect.Effect<ResolvedIdentity, ProjectIdentityNotResolvableError>;
	}
>() {}
