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
	// Data.Error passes `args.message` (absent here) to the native Error
	// constructor, which then sets no own `message`; this prototype getter is
	// what every read sees, so Cause.pretty() surfaces operation/table/reason.
	// Being a getter, `message` is not an own enumerable key: `toJSON()` and
	// `JSON.stringify(err)` carry the structured fields, not the text.
	override get message(): string {
		return `[${this.operation} ${this.table}] ${this.reason}`;
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
		let msg: unknown;
		let cause: unknown;
		try {
			msg = n.message;
		} catch {
			msg = undefined;
		}
		try {
			cause = n.cause;
		} catch {
			cause = undefined;
		}
		if (typeof msg === "string" && msg.length > 0) {
			best = msg;
		}
		// A string cause is itself the reason and terminates the chain.
		if (typeof cause === "string") {
			if (cause.length > 0) best = cause;
			break;
		}
		node = cause;
	}
	if (best !== undefined) return best;
	if (e && typeof e === "object") {
		// Object with no useful message/cause — JSON.stringify gives more
		// information than `String(e)` would (which produces "[object Object]").
		try {
			// JSON.stringify can also return undefined without throwing (a
			// toJSON that returns undefined) — fall through to String then.
			const json = JSON.stringify(e);
			if (json !== undefined) return json;
		} catch {
			// Circular reference or non-serializable value; fall through.
		}
	}
	try {
		return String(e);
	} catch {
		return "<unserializable error>";
	}
};
