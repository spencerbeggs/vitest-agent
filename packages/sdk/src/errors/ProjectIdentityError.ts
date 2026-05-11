import { Data } from "effect";

/**
 * One source the resolver tried while looking for project identity.
 *
 * `source` is a stable label (`"explicit"`, `"toml"`, `"git-remote"`,
 * `"package-repository"`, `"package-name"`) the error message and
 * downstream tooling can switch on. `reason` explains why the source
 * didn't produce a value (e.g., "not configured", "git command failed",
 * "URL canonicalization rejected the value").
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
