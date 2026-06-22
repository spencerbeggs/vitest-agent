import { Data } from "effect";

/**
 * Error raised when project discovery (glob, file read, or stat) fails.
 * @public
 */
export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
	readonly operation: "glob" | "read" | "stat";
	readonly path: string;
	readonly reason: string;
}> {
	constructor(args: {
		readonly operation: "glob" | "read" | "stat";
		readonly path: string;
		readonly reason: string;
	}) {
		super(args);
		Object.defineProperty(this, "message", {
			value: `[${args.operation} ${args.path}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}
