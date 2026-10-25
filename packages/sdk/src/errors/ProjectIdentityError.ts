import { Data } from "effect";

/**
 * One source the resolver tried while looking for project identity.
 *
 * `source` is a stable label (`"explicit"`, `"toml"`, `"git-remote"`,
 * `"package-repository"`, `"package-name"`) the error message and
 * downstream tooling can switch on. `reason` explains why the source
 * didn't produce a value (e.g., "not configured", "git command failed",
 * "URL canonicalization rejected the value").
 * @public
 */
export interface ProjectIdentityCandidate {
	readonly source: string;
	readonly reason: string;
}

/**
 * Raised at plugin / sidecar / MCP boot when the project's identity
 * cannot be resolved through the documented fallback chain. The error
 * carries the full list of attempted sources so the user knows which
 * lever to pull (set `projectId` explicitly, configure the TOML file,
 * add a git remote, or set `name` in `package.json`).
 *
 * Replaces the legacy `WorkspaceRootNotFoundError` for callers that
 * went through the new resolver.
 * @public
 */
export class ProjectIdentityNotResolvableError extends Data.TaggedError("ProjectIdentityNotResolvableError")<{
	readonly tried: ReadonlyArray<ProjectIdentityCandidate>;
}> {
	constructor(args: { readonly tried: ReadonlyArray<ProjectIdentityCandidate> }) {
		super(args);
		const summary =
			args.tried.length === 0 ? "no sources attempted" : args.tried.map((c) => `${c.source}: ${c.reason}`).join("; ");
		Object.defineProperty(this, "message", {
			value: `Project identity could not be resolved (${summary}). Set projectId explicitly in vitest.config.ts, projectKey in vitest-agent.config.toml, configure a git remote, or add "name" to package.json.`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/**
 * Which identity source failed to be read or decoded.
 *
 * - `toml` — `vitest-agent.config.toml` was found but could not be read,
 *   parsed, or did not satisfy `VitestAgentConfig`.
 * - `package-json` — the root `package.json` discovery named could not be
 *   read (other than not existing) or is not valid JSON.
 * - `workspace` — workspace discovery itself failed inside a workspace (a
 *   malformed manifest, an unexpandable `packages:` pattern); a directory
 *   that sits in no workspace is not an error, it is an absent source.
 * @public
 */
export type ProjectIdentitySource = "toml" | "package-json" | "workspace";

/**
 * Raised by `ProjectIdentity.resolve` when a source that IS present cannot
 * be used: a malformed `vitest-agent.config.toml`, an unreadable or
 * malformed root `package.json`, or a workspace manifest discovery rejects.
 *
 * Distinct from `ProjectIdentityNotResolvableError`, which means every
 * source was absent or empty. An operator with a broken config file must
 * see this rather than silently receive the default identity (issue 321);
 * `cause` carries the kit's structured failure for callers that branch on
 * it, and `detail` its one-line message.
 * @public
 */
export class ProjectIdentitySourceError extends Data.TaggedError("ProjectIdentitySourceError")<{
	readonly source: ProjectIdentitySource;
	readonly path: string;
	readonly detail: string;
	readonly cause: unknown;
}> {
	constructor(args: {
		readonly source: ProjectIdentitySource;
		readonly path: string;
		readonly detail: string;
		readonly cause: unknown;
	}) {
		super(args);
		const what =
			args.source === "toml"
				? "vitest-agent.config.toml"
				: args.source === "package-json"
					? "root package.json"
					: "workspace discovery";
		Object.defineProperty(this, "message", {
			value: `Project identity source ${what} at ${args.path} could not be used: ${args.detail}. Fix the file, or set projectId explicitly in vitest.config.ts.`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/**
 * Every failure `ProjectIdentity.resolve` can surface: no source produced a
 * value, or a present source could not be used.
 * @public
 */
export type ProjectIdentityError = ProjectIdentityNotResolvableError | ProjectIdentitySourceError;
