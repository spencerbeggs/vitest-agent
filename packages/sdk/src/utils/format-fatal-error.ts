import { Cause } from "effect";

const ISSUE_URL = "https://github.com/spencerbeggs/vitest-agent/issues";
const FIBER_FAILURE_CAUSE_KEY = Symbol.for("effect/Runtime/FiberFailure/Cause");

/**
 * Format an unknown error into a human-readable string with issue URL.
 *
 * Extraction order:
 * 1. Effect Cause — use `Cause.pretty()` for full formatting
 * 2. Effect FiberFailure — extract Cause and use `Cause.pretty()`
 * 3. Plain Error — extract `.message` and `.stack`
 * 4. Unknown — `String(err)`
 *
 * @public
 */
export function formatFatalError(err: unknown): string {
	let detail: string;

	if (Cause.isCause(err)) {
		detail = Cause.pretty(err);
	} else if (err != null && typeof err === "object" && FIBER_FAILURE_CAUSE_KEY in err) {
		const cause = (err as Record<symbol, unknown>)[FIBER_FAILURE_CAUSE_KEY];
		if (Cause.isCause(cause)) {
			detail = Cause.pretty(cause);
		} else {
			detail = String(err);
		}
	} else if (err instanceof Error) {
		detail = err.stack ?? err.message;
	} else if (err !== null && typeof err === "object") {
		try {
			detail = JSON.stringify(err, null, 2);
		} catch {
			detail = String(err);
		}
	} else {
		detail = String(err);
	}

	return `${detail}\nPlease report at ${ISSUE_URL}`;
}
