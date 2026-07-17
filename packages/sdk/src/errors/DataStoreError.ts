import { Data } from "effect";

/**
 * Error raised when a SQLite operation fails at read, write, or migration time.
 * @public
 */
export class DataStoreError extends Data.TaggedError("DataStoreError")<{
	readonly operation: "read" | "write" | "migrate";
	readonly table: string;
	readonly reason: string;
}> {
	constructor(args: {
		readonly operation: "read" | "write" | "migrate";
		readonly table: string;
		readonly reason: string;
	}) {
		super(args);
		// Data.Error's constructor calls super(args.message, ...) which sets this.message = ""
		// (since we don't pass a message field). Replace with a derived message so that
		// Cause.pretty() surfaces the operation/table/reason instead of "An error has occurred".
		Object.defineProperty(this, "message", {
			value: `[${args.operation} ${args.table}] ${args.reason}`,
			enumerable: true,
			writable: false,
			configurable: true,
		});
	}
}

/**
 * Extract a human-readable reason string from an Effect SqlError or unknown error.
 *
 * SqlError wraps the underlying `node:sqlite` driver error in `cause`. The actual
 * SQLite message (e.g. "SQLITE_BUSY: database is locked", "UNIQUE constraint
 * failed: ...") lives on the DEEPEST node in the `cause` chain, while the outer
 * `message`s are generic ("Failed to execute statement"). The v4 driver commonly
 * nests two such wrappers, so the real reason sits at `cause.cause.message` — we
 * walk the full chain and return the deepest non-empty message. Guarded against
 * circular `cause` references.
 * @public
 */
export const extractSqlReason = (e: unknown): string => {
	const seen = new Set<unknown>();
	let best: string | undefined;
	let node: unknown = e;
	while (node && typeof node === "object" && !seen.has(node)) {
		seen.add(node);
		const n = node as { message?: unknown; cause?: unknown };
		if (typeof n.message === "string" && n.message.length > 0) {
			best = n.message;
		}
		// A string cause is itself the reason and terminates the chain.
		if (typeof n.cause === "string") {
			if (n.cause.length > 0) best = n.cause;
			break;
		}
		node = n.cause;
	}
	if (best !== undefined) return best;
	if (e && typeof e === "object") {
		// Object with no useful message/cause — JSON.stringify gives more
		// information than `String(e)` would (which produces "[object Object]").
		try {
			return JSON.stringify(e);
		} catch {
			// Circular reference or non-serializable value; fall through.
		}
	}
	return String(e);
};
