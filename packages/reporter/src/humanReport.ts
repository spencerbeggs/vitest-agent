/**
 * The report-time human render: a cell's Ink half drawn to a string
 * through Ink's `renderToString`, inside the kit's `UiProvider`.
 *
 * Loaded only by a dynamic import in `renderHumanStringForReport`, so
 * React and Ink load when a human report is actually rendered, never on
 * the agent / CI path that imports the reporter. One of the two
 * sanctioned lazy-loaded modules in this package (with `streamView.ts`).
 *
 * @internal
 */

import type { CliTheme } from "@effected/cli";
import { CliUi, UiProvider } from "@effected/cli/ui";
import { TerminalEnv } from "@effected/env";
import type { DispatchInputs } from "@vitest-agent/sdk";
import { FileLinkProvider, dispatchInk } from "@vitest-agent/ui/ink";
import type { Layer } from "effect";
import { Effect } from "effect";
import { renderToString } from "ink";
import { createElement } from "react";
import { resolveFileLink } from "./fileLinks.js";

/** The width a report is laid out at when no terminal width is known. */
const FALLBACK_COLUMNS = 80;

/**
 * Render the matched cell's Ink half to a string, or `null` when the cell
 * has no Ink half (the caller falls back to the agent string).
 *
 * The layout width is `width` when given, else the terminal's
 * (`TerminalEnv.width`: stdout's columns, else `COLUMNS`, else 80 — so a
 * non-TTY run lays out at 80). File paths are drawn through the link writer
 * the environment decides (`resolveFileLink`): the cell's own string gets it
 * as `CellOptions.link`, and the tree through `FileLinkProvider`.
 *
 * @internal
 */
export const renderInkReport = async (
	inputs: DispatchInputs,
	env: Layer.Layer<CliTheme | TerminalEnv>,
	width: number | undefined,
): Promise<string | null> => {
	const { context, columns, link } = await Effect.runPromise(
		Effect.gen(function* () {
			const context = yield* CliUi.context;
			const terminal = yield* TerminalEnv;
			const link = yield* resolveFileLink;
			return { context, columns: width ?? terminal.width(FALLBACK_COLUMNS), link };
		}).pipe(Effect.provide(env)),
	);
	// `dispatchInk`, not the bare table: it appends the notes the agent path's
	// `dispatch` appends (scoped coverage, stray output) under the cell.
	const element = dispatchInk(inputs, { link });
	if (element === null) return null;
	return renderToString(
		createElement(UiProvider, { value: context }, createElement(FileLinkProvider, { link }, element)),
		{ columns },
	);
};
