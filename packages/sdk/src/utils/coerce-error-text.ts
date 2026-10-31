import { Inspectable } from "effect";

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
 * - everything else → core's `Inspectable.toStringUnknown(value, 0)`: compact
 *   JSON for objects (an `Error` renders its `name` and `message`, a circular
 *   reference is dropped, a `Redacted` value renders `<redacted>`), and
 *   `Formatter.format` for other primitives (`10n`, `Symbol(s)`); it falls
 *   back to `String(value)` itself, and this helper returns
 *   `"<unserializable>"` when that throws too (a null-prototype object)
 *
 * @public
 */
export const coerceErrorText = (value: unknown): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	try {
		return Inspectable.toStringUnknown(value, 0);
	} catch {
		return "<unserializable>";
	}
};

/**
 * Read a named field off an unknown error-like value and coerce it with
 * {@link coerceErrorText}, guarding the property access itself. A live getter
 * that throws (Effect's `ConfigError.message` when its cause lacks
 * `toString`) throws at the read site — `coerceErrorText(e.message)` never
 * reaches the helper's own exception handling. Route every read of an
 * untrusted error object's field through this helper instead.
 *
 * - `null` / non-object sources → `undefined`
 * - a getter that throws → `"<unreadable field>"`
 * - otherwise → `coerceErrorText(value)`
 *
 * @public
 */
export const coerceErrorField = (source: unknown, key: string): string | undefined => {
	if (source === null || (typeof source !== "object" && typeof source !== "function")) return undefined;
	let value: unknown;
	try {
		value = (source as Record<string, unknown>)[key];
	} catch {
		return "<unreadable field>";
	}
	return coerceErrorText(value);
};
