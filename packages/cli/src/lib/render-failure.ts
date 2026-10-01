import type { FailureDetails } from "@effected/cli";
import { Cancelled, CliRuntime, NotInteractive } from "@effected/cli";
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

/**
 * One rendering for every failure `CliRuntime.main` reports, its first line
 * led by `vitest-agent: `. The kit says which kind it is
 * (`details.isDefect`, exact: the cause carries no typed failure).
 *
 * - A typed failure from the error channel (a `PlatformError`, `SqlError`,
 *   `MigrationError`) is the one line we own: `vitest-agent: <Tag>: <message>`.
 * - Everything else is delegated to `CliRuntime.defaultRender`, the plain lines
 *   of the kit's `CliFailure.toDoc(cause)`: `Cancelled` / `NotInteractive` keep
 *   their fixed line (`vitest-agent: cancelled; nothing written`), a
 *   `SchemaError` is a tree, and a defect is its message plus a `stack` of the
 *   program's own frames (Node and Effect internals cleaned out), then the
 *   issue link.
 *
 * `ShowHelp` and runWith-rendered `UserError`s never reach here (the kit skips
 * them).
 *
 * @internal
 */
export const renderFailure = (error: unknown, details: FailureDetails): ReadonlyArray<string> => {
	if (!details.isDefect && !isKitRendered(error)) {
		const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
		return [`vitest-agent: ${failureName(error)}${message ? `: ${message}` : ""}`];
	}
	const rendered = CliRuntime.defaultRender(error, details);
	const [first = failureName(error), ...rest] = typeof rendered === "string" ? [rendered] : rendered;
	return [`vitest-agent: ${first}`, ...rest, ...(details.isDefect ? [`Please report at ${ISSUE_URL}`] : [])];
};
