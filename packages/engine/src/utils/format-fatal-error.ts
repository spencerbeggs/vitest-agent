import { CliFailure, Render } from "@effected/cli";
import { Cause } from "effect";

const ISSUE_URL = "https://github.com/spencerbeggs/vitest-agent/issues";

/**
 * Plain text for a person reading stderr: no escapes of any kind, Unicode
 * glyphs, unbounded width (a terminal wraps a long line itself).
 */
const CONTEXT = Render.contextOf({ audience: "human" });

/**
 * Format an unexpected failure for stderr, with the issue URL appended.
 *
 * @remarks
 * Under Effect v4, `Effect.runPromise` / `Effect.runSync` reject with
 * `Cause.squash` of the failure: the error value itself, with no
 * FiberFailure wrapper and no `Cause` attached. So a `Cause` is used as it
 * is (one from `Effect.runPromiseExit` keeps every reason and the span
 * trail), and anything else is rendered as a defect, `Cause.die(err)`: an
 * unexpected throw is a bug to report, and a defect is the shape whose
 * document carries the stack. `@effected/cli`'s `CliFailure.toDoc` keeps
 * the program's own frames, hides `node_modules` and runtime frames,
 * follows an `Error.cause` chain, and renders a non-`Error` value as its
 * text.
 *
 * Total: `CliFailure.toDoc` guards the `stack`, `message`, `cause` and
 * `issue` reads itself, but wrapping a `Proxy` whose traps throw can still
 * throw, so any throw while formatting falls back to a fixed marker naming
 * the value's constructor.
 *
 * @param err - the thrown value, rejection reason, or `Cause`
 * @returns the formatted failure followed by the issue-report line
 * @public
 */
export const formatFatalError = (err: unknown): string => {
	let detail: string;
	try {
		const cause = Cause.isCause(err) ? err : Cause.die(err);
		detail = Render.plain(CliFailure.toDoc(cause), CONTEXT);
	} catch {
		detail = `<unserializable ${constructorName(err)}>`;
	}
	return `${detail}\nPlease report at ${ISSUE_URL}`;
};

/** The value's constructor name, guarded: an own `constructor` getter or a `Proxy` trap can throw too. */
const constructorName = (err: unknown): string => {
	try {
		const name: unknown = (err as { constructor?: { name?: unknown } } | null | undefined)?.constructor?.name;
		return typeof name === "string" && name !== "" ? name : "error";
	} catch {
		return "error";
	}
};
