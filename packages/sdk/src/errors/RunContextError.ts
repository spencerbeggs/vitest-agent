import { Data } from "effect";

/**
 * Surfaces unexpected git-command failures from `RunContext`. Expected
 * non-zero exits (e.g., "not a git repository") are absorbed via
 * `Effect.option` and surface as `null` columns — they are not errors.
 * This error is reserved for "the executable is missing" /
 * "permission denied" / other system-level failures the caller cannot
 * meaningfully recover from.
 * @public
 */
export class GitCommandError extends Data.TaggedError("GitCommandError")<{
	readonly command: string;
	readonly reason: string;
}> {
	constructor(args: { readonly command: string; readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[git ${args.command}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/**
 * Internal probe miss — consumed by `Effect.firstSuccessOf` /
 * `Effect.orElse` inside the host-metadata probe chain. Never surfaces
 * to the caller of `RunContext.captureRunContext`; the public API
 * always returns a complete `RunContext` (with NULLs for missed
 * probes).
 * @internal
 */
export class ProbeMissError extends Data.TaggedError("ProbeMissError")<{
	readonly probe: string;
}> {}
