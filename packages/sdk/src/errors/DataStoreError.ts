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
 * SqlError wraps the underlying better-sqlite3 error in `cause`. The actual SQLite
 * message (e.g. "SQLITE_BUSY: database is locked", "UNIQUE constraint failed: ...")
 * lives on `cause.message`, while the SqlError's own `message` is generic
 * ("Failed to execute statement"). Prefer the cause's message when available.
 * @public
 */
export const extractSqlReason = (e: unknown): string => {
	const err = e as { cause?: { message?: string } | string; message?: string };
	if (err && typeof err === "object") {
		if (err.cause) {
			if (typeof err.cause === "string") return err.cause;
			if (typeof err.cause === "object" && typeof err.cause.message === "string") {
				return err.cause.message;
			}
		}
		if (typeof err.message === "string" && err.message.length > 0) {
			return err.message;
		}
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
