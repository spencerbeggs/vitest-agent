import type { FailureDetails } from "@effected/cli";
import { Fmt } from "@effected/cli";
import { Schema } from "effect";

/**
 * The one-line name of a typed failure: its `_tag` when it carries one (a
 * `PlatformError`, `SqlError`, `StoreError`), else its `Error` name.
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
 * the rejected values. The kit says which are its own (`isCancelled` /
 * `isNotInteractive`), whichever channel they arrived through.
 */
const isKitRendered = (error: unknown, details: FailureDetails): boolean =>
	details.isCancelled || details.isNotInteractive || Schema.isSchemaError(error);

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
 *   `StoreError`) is the one line we own: `vitest-agent: <Tag>: <message>`,
 *   the message passed through `Fmt.sanitize` (it can carry a path or SQL text).
 * - Everything else is delegated to `details.lines({ status: false })`, the
 *   kit's report for this run (its colour, links, and `displayPath`) with the
 *   status glyph / `[FAIL]` tag left off, so our prefix replaces the marker
 *   rather than doubling it: `Cancelled` / `NotInteractive` keep their fixed
 *   line (`vitest-agent: cancelled; nothing written`), a `SchemaError` is a
 *   tree, and a defect is its message plus a `stack` of the program's own
 *   frames (`node_modules`, Node, and Effect frames hidden and counted), then
 *   the issue link. A `Cancelled` or `NotInteractive` is never a bug, so it
 *   never gets the issue link, even when it arrives as a defect (a cancel from
 *   `CliPrompt.fallback`).
 *
 * `ShowHelp` and runWith-rendered `UserError`s never reach here (the kit skips
 * them).
 *
 * @internal
 */
export const renderFailure = (error: unknown, details: FailureDetails): ReadonlyArray<string> => {
	const kitRendered = isKitRendered(error, details);
	if (!details.isDefect && !kitRendered) {
		const message = oneLine(error instanceof Error ? error.message : typeof error === "string" ? error : "");
		return [`vitest-agent: ${oneLine(failureName(error))}${message ? `: ${message}` : ""}`];
	}
	const [first = failureName(error), ...rest] = details.lines({ status: false });
	return [
		`vitest-agent: ${first}`,
		...rest,
		...(details.isDefect && !kitRendered ? [`Please report at ${ISSUE_URL}`] : []),
	];
};
