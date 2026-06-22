import { Data } from "effect";

/**
 * Error raised when the data directory path cannot be resolved.
 *
 * The most common case is missing workspace identity: no `projectKey`
 * override in `vitest-agent.config.toml` and no `name` field in
 * the root workspace's `package.json`. The path is a function of the
 * workspace's identity, so without one we have no canonical location to
 * write to.
 * @public
 */
export class PathResolutionError extends Data.TaggedError("PathResolutionError")<{
	readonly reason: string;
}> {
	constructor(args: { readonly reason: string }) {
		super(args);
		Object.defineProperty(this, "message", {
			value: args.reason,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}
