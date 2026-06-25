/**
 * Cell-type aliases for the dispatcher.
 *
 * Each cell exposes one or more "halves" the dispatcher selects on
 * based on the resolved `consoleMode`:
 *
 * - `agent`: returns a token-economy string rendered to stdout once
 *   at end-of-run.
 * - `ink`: returns a React Ink tree rendered live to the terminal
 *   during the run (only meaningful when `consoleMode === "stream"`).
 *
 * The matrix is total; the `ink` half is optional for cells where
 * the agent rendering is already minimal enough that no special
 * Ink layout is warranted.
 */

import type { CellOptions, DispatchInputs } from "@vitest-agent/sdk";
import type { ReactElement } from "react";

/**
 * A cell's agent-string half: pure function from dispatch inputs to a
 * token-economy string emitted once at end-of-run.
 *
 * @public
 */
export type AgentCellFn = (inputs: DispatchInputs, opts: CellOptions) => string;

/**
 * A cell's Ink half: pure function from dispatch inputs to a React
 * element rendered live to the terminal.
 *
 * @public
 */
export type InkCellFn = (inputs: DispatchInputs, opts: CellOptions) => ReactElement;

/**
 * One entry in the dispatcher matrix: an agent-string renderer and an
 * optional Ink-tree renderer for the same `(RunShape, RunOutcome)` pair.
 *
 * @public
 */
export interface Cell {
	/** Agent-string half — always present. */
	readonly agent: AgentCellFn;
	/** Ink-tree half — omitted for cells where agent output is sufficient. */
	readonly ink?: InkCellFn;
}
