/**
 * Internal cell-type aliases for the dispatcher.
 *
 * Each cell exposes one or more "halves" the dispatcher selects on
 * based on the resolved `consoleMode`:
 *
 * - `agent`: returns a token-economy string rendered to stdout once
 *   at end-of-run.
 * - `ink`: returns a React Ink tree rendered live to the terminal
 *   during the run (only meaningful when `consoleMode === "ink"`).
 *
 * The matrix is total; the `ink` half is optional for cells where
 * the agent rendering is already minimal enough that no special
 * Ink layout is warranted.
 *
 * @packageDocumentation
 */

import type { ReactElement } from "react";
import type { CellOptions, DispatchInputs } from "vitest-agent-sdk";

export type AgentCellFn = (inputs: DispatchInputs, opts: CellOptions) => string;
export type InkCellFn = (inputs: DispatchInputs, opts: CellOptions) => ReactElement;

export interface Cell {
	readonly agent: AgentCellFn;
	readonly ink?: InkCellFn;
}
