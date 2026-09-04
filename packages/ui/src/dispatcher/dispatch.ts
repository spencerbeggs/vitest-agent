/**
 * The shape-tailored dispatcher matrix.
 *
 * Given the classified `(run-shape, outcome)` pair on
 * `DispatchInputs`, selects the appropriate cell renderer and
 * invokes its `agent` half. Phase 5 adds the `ink` half; phase 2 ships
 * only the agent string output.
 *
 * The cells themselves are pure functions of `(inputs, opts)`. The
 * dispatcher's only job is the table lookup — no fallback logic, no
 * default cell, because the matrix is total (every `RunShape × RunOutcome`
 * pair maps to a cell, with `single-test × threshold-violation` being a
 * documented no-op that returns the empty string).
 */

import type { CellOptions, DispatchInputs, RunOutcome, RunShape } from "@vitest-agent/sdk";
import { formatScopedCoverageNote } from "@vitest-agent/sdk";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { Cell } from "./cell-types.js";
import { renderSingleFileFail } from "./cells/single-file-fail.js";
import { renderSingleFilePass } from "./cells/single-file-pass.js";
import { renderSingleFileThreshold } from "./cells/single-file-threshold.js";
import { renderSingleProjectFail } from "./cells/single-project-fail.js";
import { renderSingleProjectPass } from "./cells/single-project-pass.js";
import { renderSingleProjectThreshold } from "./cells/single-project-threshold.js";
import { renderSingleTestFail } from "./cells/single-test-fail.js";
import { renderSingleTestPass } from "./cells/single-test-pass.js";
import { renderSingleTestThreshold } from "./cells/single-test-threshold.js";
import { renderWorkspaceFail } from "./cells/workspace-fail.js";
import { renderWorkspacePass } from "./cells/workspace-pass.js";
import { renderWorkspaceThreshold } from "./cells/workspace-threshold.js";

/**
 * The 4×3 cell table. Exported for the test harness so spy-based
 * routing tests can introspect the wiring without re-deriving it from
 * source.
 *
 * @public
 */
export const dispatcherTable: Readonly<Record<RunShape, Readonly<Record<RunOutcome, Cell>>>> = {
	"single-test": {
		"all-pass": renderSingleTestPass,
		"some-fail": renderSingleTestFail,
		"threshold-violation": renderSingleTestThreshold,
	},
	"single-file": {
		"all-pass": renderSingleFilePass,
		"some-fail": renderSingleFileFail,
		"threshold-violation": renderSingleFileThreshold,
	},
	"single-project": {
		"all-pass": renderSingleProjectPass,
		"some-fail": renderSingleProjectFail,
		"threshold-violation": renderSingleProjectThreshold,
	},
	workspace: {
		"all-pass": renderWorkspacePass,
		"some-fail": renderWorkspaceFail,
		"threshold-violation": renderWorkspaceThreshold,
	},
};

/**
 * Dispatch to the cell that matches `(inputs.shape, inputs.outcome)`
 * and return its agent-half string output.
 *
 * @param inputs - the classified dispatch inputs
 * @param opts - cell rendering options
 * @returns the agent-string output for the matched cell
 * @public
 */
export const dispatch = (inputs: DispatchInputs, opts: CellOptions): string => {
	const cell = dispatcherTable[inputs.shape][inputs.outcome];
	const body = cell.agent(inputs, opts);
	const note = scopedCoverageNoteFor(inputs);
	return note !== null ? `${body}\n${note}` : body;
};

/**
 * Build the scoped-coverage note for this run, or `null` on a full
 * (non-scoped) run. Shared by {@link dispatch} and {@link dispatchInk} so
 * both render paths surface the same information (issue #160 gap 1) —
 * Vitest's coverage thresholds are meaningless against a subset of the
 * project's test files, so every cell's own threshold-flavored coverage
 * text is followed by an explanation of why to disregard it.
 *
 * @internal
 */
const scopedCoverageNoteFor = (inputs: DispatchInputs): string | null => {
	const cov = inputs.state.coverage;
	if (cov === null || cov.scoped !== true) return null;
	return formatScopedCoverageNote(cov.scopedFiles ?? 0, cov.totalFiles);
};

/**
 * Dispatch to the cell that matches `(inputs.shape, inputs.outcome)`
 * and return its Ink-half React tree. Returns `null` when the matched
 * cell does not expose an `ink` half — callers should fall back to
 * the agent string in that case.
 *
 * @param inputs - the classified dispatch inputs
 * @param opts - cell rendering options
 * @returns the Ink React element, or `null` when the cell has no Ink half
 * @public
 */
export const dispatchInk = (inputs: DispatchInputs, opts: CellOptions): ReactElement | null => {
	const cell = dispatcherTable[inputs.shape][inputs.outcome];
	if (cell.ink === undefined) return null;
	const element = cell.ink(inputs, opts);
	const note = scopedCoverageNoteFor(inputs);
	if (note === null) return element;
	// No JSX here — this module has a `.ts` extension (shared by both the
	// agent-string and Ink dispatch entry points), so the Ink tree is built
	// via `createElement` rather than a `.tsx` JSX literal.
	return createElement(Box, { flexDirection: "column" }, element, createElement(Text, null, note));
};
