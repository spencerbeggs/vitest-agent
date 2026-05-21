/**
 * Converts a raw Vitest assertion value (`.expected` / `.actual`) into a
 * one-line string suitable for display in the stream renderer.
 *
 * The value stays within the Vitest-side error object; this helper
 * converts it to a string representation that crosses the ReportError
 * schema boundary. Returns `undefined` when there is no value to show
 * (i.e., the input is `undefined`).
 *
 * @packageDocumentation
 */

/**
 * Stringify a raw Vitest assertion `.expected` or `.actual` value into a
 * single-line string.
 *
 * - `undefined` → `undefined` (signals "no value — omit the field")
 * - `null` → `"null"`
 * - primitives (string, number, boolean, bigint) → `String(value)`
 * - objects / arrays → `JSON.stringify(value)`, falling back to
 *   `String(value)` for circular or otherwise un-serialisable values
 */
export const stringifyFailureValue = (value: unknown): string | undefined => {
	if (value === undefined) return undefined;
	if (value === null) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};
