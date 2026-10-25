/**
 * The file-link writer the reporter's human renders draw paths through
 * (issue #541): `@effected/cli`'s `CliLinks.linker` over the services the
 * reporter's environment carries.
 *
 * The kit decides everything about a link. `CliLinks` picks where a file
 * opens (`vscode://file/<path>:<line>:<col>` when `TERM_PROGRAM` is VS Code
 * or a `.vscode/` directory sits at the project root, `file://` otherwise,
 * or nothing under `editorLinks: "off"`); `TerminalEnv` says whether stdout
 * renders OSC 8 at all (a pipe, tmux, GNU screen, `NO_COLOR` and
 * `NO_HYPERLINK` all say no); and the `Audience` rule keeps every escape
 * away from an agent. The writer is pure, so it is resolved once and handed
 * to the cells (`CellOptions.link`) and to the Ink tree (`FileLinkProvider`).
 *
 * @internal
 */

import { CliLinks } from "@effected/cli";
import { Audience, TerminalEnv } from "@effected/env";
import type { CellOptions } from "@vitest-agent/sdk";
import { Effect, Option } from "effect";

/**
 * The link writer: a file target and a label in, the label (linked when the
 * reader can follow it) out. The same shape as `CellOptions.link`.
 *
 * @internal
 */
export type FileLink = NonNullable<CellOptions["link"]>;

/** The writer an agent, a pipe or an environment without the kit's services gets: the label alone. */
export const plainFileLink: FileLink = (_target, label) => label;

/**
 * Resolve the writer from the environment, when it carries the kit's
 * `CliLinks`, `TerminalEnv` and `Audience`; the label alone when any is
 * missing (a test environment fixed to a theme only, say). It never fails
 * and never requires: a reporter rendering without `CliEnv` keeps working,
 * it just writes no link.
 */
export const resolveFileLink: Effect.Effect<FileLink> = Effect.gen(function* () {
	const links = yield* Effect.serviceOption(CliLinks);
	const terminal = yield* Effect.serviceOption(TerminalEnv);
	const audience = yield* Effect.serviceOption(Audience);
	if (Option.isNone(links) || Option.isNone(terminal) || Option.isNone(audience)) return plainFileLink;
	return CliLinks.linker({
		links: links.value,
		hyperlinks: terminal.value.stdout.hyperlinks,
		audience: audience.value.kind,
	});
});
