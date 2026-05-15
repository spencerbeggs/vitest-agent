/**
 * The shape-tailored dispatcher matrix.
 *
 * Given the classified `(run-shape, outcome)` pair on
 * {@link DispatchInputs}, selects the appropriate cell renderer and
 * invokes its `agent` half. Phase 5 adds the `ink` half; phase 2 ships
 * only the agent string output.
 *
 * The cells themselves are pure functions of `(inputs, opts)`. The
 * dispatcher's only job is the table lookup — no fallback logic, no
 * default cell, because the matrix is total (every `RunShape × RunOutcome`
 * pair maps to a cell, with `single-test × threshold-violation` being a
 * documented no-op that returns the empty string).
 *
 * @packageDocumentation
 */

import type { ReactElement } from "react";
import type { CellOptions, DispatchInputs, RunOutcome, RunShape } from "vitest-agent-sdk";
import type { Cell } from "./cell-types.js";
import {
	renderSingleFileFail,
	renderSingleFilePass,
	renderSingleFileThreshold,
	renderSingleProjectFail,
	renderSingleProjectPass,
	renderSingleProjectThreshold,
	renderSingleTestFail,
	renderSingleTestPass,
	renderSingleTestThreshold,
	renderWorkspaceFail,
	renderWorkspacePass,
	renderWorkspaceThreshold,
} from "./cells/index.js";

/**
 * The 4×3 cell table. Exported for the test harness so spy-based
 * routing tests can introspect the wiring without re-deriving it from
 * source.
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
 */
export const dispatch = (inputs: DispatchInputs, opts: CellOptions): string => {
	const cell = dispatcherTable[inputs.shape][inputs.outcome];
	return cell.agent(inputs, opts);
};

/**
 * Dispatch to the cell that matches `(inputs.shape, inputs.outcome)`
 * and return its Ink-half React tree. Returns `null` when the matched
 * cell does not expose an `ink` half — callers should fall back to
 * the agent string in that case.
 */
export const dispatchInk = (inputs: DispatchInputs, opts: CellOptions): ReactElement | null => {
	const cell = dispatcherTable[inputs.shape][inputs.outcome];
	return cell.ink !== undefined ? cell.ink(inputs, opts) : null;
};
