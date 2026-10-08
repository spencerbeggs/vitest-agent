/**
 * The Ink half of the shape-tailored dispatcher matrix.
 *
 * Every live cell re-expresses its agent string as a column of Ink
 * `<Text>` rows (status glyphs and line prefixes painted from the shared
 * vocabulary). `single-test × threshold-violation` is the documented
 * no-op: it has no Ink half, so a caller falls back to the agent string.
 *
 * This module lives behind the `@vitest-agent/ui/ink` subpath so the
 * package root, and every agent / CI run that imports only the root,
 * never loads React or Ink.
 */

import type { CellOptions, DispatchInputs, RunOutcome, RunShape } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { AgentCellFn } from "../dispatcher/cell-types.js";
import { dispatcherTable, scopedCoverageNoteFor, strayOutputNoteFor } from "../dispatcher/dispatch.js";
import { renderAgentStringAsInk } from "./ink-helpers.js";

/**
 * A cell's Ink half: pure function from dispatch inputs to a React
 * element rendered to the terminal.
 *
 * @public
 */
export type InkCellFn = (inputs: DispatchInputs, opts: CellOptions) => ReactElement;

/** The Ink half of a cell whose live view is its agent string, painted. */
const asInk =
	(agent: AgentCellFn): InkCellFn =>
	(inputs, opts) =>
		renderAgentStringAsInk(agent(inputs, opts));

const inkOf = (shape: RunShape, outcome: RunOutcome): InkCellFn => asInk(dispatcherTable[shape][outcome].agent);

/**
 * The 4×3 Ink cell table, keyed by the same `(RunShape, RunOutcome)`
 * matrix as the root entry's `dispatcherTable`. An `undefined` entry is a
 * cell with no Ink half (`single-test × threshold-violation`).
 *
 * @public
 */
export const inkDispatcherTable: Readonly<Record<RunShape, Readonly<Record<RunOutcome, InkCellFn | undefined>>>> = {
	"single-test": {
		"all-pass": inkOf("single-test", "all-pass"),
		"some-fail": inkOf("single-test", "some-fail"),
		"threshold-violation": undefined,
	},
	"single-file": {
		"all-pass": inkOf("single-file", "all-pass"),
		"some-fail": inkOf("single-file", "some-fail"),
		"threshold-violation": inkOf("single-file", "threshold-violation"),
	},
	"single-project": {
		"all-pass": inkOf("single-project", "all-pass"),
		"some-fail": inkOf("single-project", "some-fail"),
		"threshold-violation": inkOf("single-project", "threshold-violation"),
	},
	workspace: {
		"all-pass": inkOf("workspace", "all-pass"),
		"some-fail": inkOf("workspace", "some-fail"),
		"threshold-violation": inkOf("workspace", "threshold-violation"),
	},
};

/**
 * Dispatch to the cell that matches `(inputs.shape, inputs.outcome)`
 * and return its Ink-half React tree, followed by the scoped-coverage
 * note on a partial run. Returns `null` when the matched cell has no Ink
 * half — callers fall back to the root entry's `dispatch` string then.
 *
 * @param inputs - the classified dispatch inputs
 * @param opts - cell rendering options
 * @returns the Ink React element, or `null` when the cell has no Ink half
 * @public
 */
export const dispatchInk = (inputs: DispatchInputs, opts: CellOptions): ReactElement | null => {
	const cell = inkDispatcherTable[inputs.shape][inputs.outcome];
	if (cell === undefined) return null;
	const element = cell(inputs, opts);
	const note = scopedCoverageNoteFor(inputs);
	const stray = strayOutputNoteFor(inputs);
	if (note === null && stray === null) return element;
	return createElement(
		Box,
		{ flexDirection: "column" },
		element,
		note !== null ? createElement(Text, null, note) : null,
		stray !== null ? createElement(Box, { marginTop: 1 }, createElement(Text, null, stray)) : null,
	);
};
