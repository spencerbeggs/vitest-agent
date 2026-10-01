import type { FailureDetails } from "@effected/cli";
import { Cancelled, CliRuntime, Fmt, NotInteractive } from "@effected/cli";
import { Schema } from "effect";

/**
 * The one-line name of a typed failure: its `_tag` when it carries one (a
 * `PlatformError`, `SqlError`, `MigrationError`), else its `Error` name.
 */
const failureName = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
		return error._tag;
	}
	return error instanceof Error ? error.name : "Error";
};

/** Where a defect's report sends the reader: a defect is a bug in this program. */
const ISSUE_URL = "https://github.com/spencerbeggs/vitest-agent/issues";

/**
 * Failures the kit renders better than one `<Tag>: <message>` line: its own
 * `Cancelled` / `NotInteractive` fixed lines, and a `SchemaError` as a tree of
 * the rejected values.
 */
const isKitRendered = (error: unknown): boolean =>
	error instanceof Cancelled || error instanceof NotInteractive || Schema.isSchemaError(error);

/** One line of text we did not write, made safe to print: controls stripped, line breaks folded to spaces. */
const oneLine = (text: string): string =>
	Fmt.sanitize(text)
		.replace(/\s*[\r\n]+\s*/g, " ")
		.trim();

/**
 * One rendering for every failure `CliRuntime.main` reports, its first line
 * led by `vitest-agent: `. The kit says which kind it is
 * (`details.isDefect`, exact: the cause carries no typed failure).
 *
 * - A typed failure from the error channel (a `PlatformError`, `SqlError`,
 *   `MigrationError`) is the one line we own: `vitest-agent: <Tag>: <message>`,
 *   the message passed through `Fmt.sanitize` (it can carry a path or SQL text).
 * - Everything else is delegated to `CliRuntime.defaultRender` with
 *   `status: false`, so our prefix replaces the kit's status glyph / `[FAIL]`
 *   tag rather than doubling it: `Cancelled` / `NotInteractive` keep their
 *   fixed line (`vitest-agent: cancelled; nothing written`), a `SchemaError` is
 *   a tree, and a defect is its message plus a `stack` of the program's own
 *   frames (Node and Effect internals cleaned out), then the issue link.
 *
 * `details.defaultLines` (the run's own report, painted and path-shortened) is
 * deliberately not used: it always leads with the status marker, so prefixing
 * it would print `vitest-agent: [FAIL] ...`.
 *
 * `ShowHelp` and runWith-rendered `UserError`s never reach here (the kit skips
 * them).
 *
 * @internal
 */
export const renderFailure = (error: unknown, details: FailureDetails): ReadonlyArray<string> => {
	if (!details.isDefect && !isKitRendered(error)) {
		const message = oneLine(error instanceof Error ? error.message : typeof error === "string" ? error : "");
		return [`vitest-agent: ${oneLine(failureName(error))}${message ? `: ${message}` : ""}`];
	}
	const rendered = CliRuntime.defaultRender(error, details, { status: false });
	const [first = failureName(error), ...rest] = typeof rendered === "string" ? rendered.split("\n") : rendered;
	return [`vitest-agent: ${first}`, ...rest, ...(details.isDefect ? [`Please report at ${ISSUE_URL}`] : [])];
};
