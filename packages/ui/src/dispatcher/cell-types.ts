/**
 * Cell-type aliases for the dispatcher.
 *
 * A cell is the agent-string renderer for one `(RunShape, RunOutcome)`
 * pair: a token-economy string rendered to stdout once at end-of-run.
 * The Ink re-expression of the same matrix lives behind the
 * `@vitest-agent/ui/ink` subpath (`inkDispatcherTable`), so this module,
 * and the package root that re-exports it, never reach React or Ink.
 */

import type { CellOptions, DispatchInputs } from "@vitest-agent/sdk";

/**
 * A cell's agent-string half: pure function from dispatch inputs to a
 * token-economy string emitted once at end-of-run.
 *
 * @public
 */
export type AgentCellFn = (inputs: DispatchInputs, opts: CellOptions) => string;

/**
 * One entry in the dispatcher matrix: the agent-string renderer for a
 * `(RunShape, RunOutcome)` pair. The Ink half of the same pair is the
 * matching entry of `inkDispatcherTable` in `@vitest-agent/ui/ink`.
 *
 * @public
 */
export interface Cell {
	/** Agent-string half — always present. */
	readonly agent: AgentCellFn;
}
