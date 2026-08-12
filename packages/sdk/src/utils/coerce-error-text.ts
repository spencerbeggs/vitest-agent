/**
 * Coerce an unknown error-field value (message, name, diff, stack, ...) into a
 * string that is safe to bind to a SQLite TEXT column or render to a terminal.
 *
 * Vitest failure values are typed as strings but are whatever the test threw:
 * `Effect.flip` on an unexpectedly-succeeding effect puts arbitrary success
 * values (routinely plain objects) into the error channel, and Effect's
 * `ConfigError.message` is a getter that throws when its cause lacks
 * `toString`. Every access here is exception-safe.
 *
 * - `undefined` / `null` → `undefined` (caller decides null vs sentinel)
 * - string → unchanged
 * - other primitives → `String(value)`
 * - objects → `JSON.stringify`, falling back to `String(value)`, falling back
 *   to `"<unserializable>"` when both throw
 *
 * @public
 */
export const coerceErrorText = (value: unknown): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	try {
		return JSON.stringify(value) ?? "<unserializable>";
	} catch {
		try {
			return String(value);
		} catch {
			return "<unserializable>";
		}
	}
};
