// Crash-handler-safe wrapper around `@vitest-agent/engine`'s
// {@link formatFatalError}.
//
// `bin.ts`'s `unhandledRejection` / `uncaughtException` handlers exist so
// a stray throw cannot kill a live MCP session (issue #191). Calling the
// formatter directly from inside them reopened exactly that hole: the sdk
// formatter it used then introspected the value it was given, and every
// probe was hijackable by a `Proxy` whose `has` / `getPrototypeOf` / `get`
// trap throws. A throw *inside* an `uncaughtException` handler is fatal to
// the process with no second chance to report it, so the crash guard would
// have crashed the process it exists to protect (issue #243). The engine
// formatter is total, but this wrapper stays as the second guard: a crash
// handler must not depend on another module's totality.

import { formatFatalError } from "@vitest-agent/engine";

/**
 * Fixed fallback emitted when the formatter itself throws. Deliberately a
 * constant: anything derived from the offending value could throw again
 * on the recovery path.
 *
 * @internal
 */
export const UNFORMATTABLE_ERROR_TEXT = "<unformattable error value — the error formatter itself threw>";

/**
 * Format an unknown error for a crash handler. Never throws.
 *
 * @param err - the value thrown or the rejection reason
 * @internal
 */
export function safeFormatFatalError(err: unknown): string {
	try {
		const formatted = formatFatalError(err);
		return typeof formatted === "string" ? formatted : UNFORMATTABLE_ERROR_TEXT;
	} catch {
		return UNFORMATTABLE_ERROR_TEXT;
	}
}
